"use server";

import { createClient } from "@/lib/supabase/server";
import { requireCapabilityOrAdmin } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function str(fd: FormData, key: string) {
  const v = fd.get(key);
  return v == null ? null : String(v).trim() || null;
}

function num(fd: FormData, key: string) {
  const v = fd.get(key);
  if (v == null || String(v).trim() === "") return 0;
  const n = Number(v);
  if (Number.isNaN(n)) throw new Error(`Invalid number for ${key}`);
  return n;
}

/**
 * Look up the canonical category name for a given category_id. The denormalized
 * `products.category` text column is always kept in sync with the category name
 * so legacy UIs (filter chips, product cards) keep working as the source of
 * truth shifts to `category_id`.
 */
async function resolveCategory(
  supabase: ReturnType<typeof createClient>,
  categoryId: string | null
): Promise<{ category_id: string | null; category: string | null }> {
  if (!categoryId) return { category_id: null, category: null };
  const { data } = await supabase
    .from("product_categories")
    .select("name")
    .eq("id", categoryId)
    .maybeSingle();
  return { category_id: categoryId, category: data?.name ?? null };
}

// ---------- products ----------

export async function createProduct(formData: FormData) {
  await requireCapabilityOrAdmin("admin.manage_products");
  const supabase = createClient();

  const name = str(formData, "name");
  if (!name) throw new Error("Product name is required");

  // Category is mandatory and must come from the categories table (no free text).
  const categoryId = str(formData, "category_id");
  if (!categoryId) throw new Error("Please select a category");

  const priceHigh = num(formData, "price_high");
  const priceMedium = num(formData, "price_medium");
  const priceLow = num(formData, "price_low");

  // `category_id` is the source of truth; we resolve and persist the
  // denormalized `category` text alongside it for backward compat.
  const cat = await resolveCategory(supabase, categoryId);
  if (!cat.category_id) throw new Error("Please select a category");
  const { data: inserted, error } = await supabase
    .from("products")
    .insert({
      name,
      sku: str(formData, "sku"),
      category: cat.category,
      category_id: cat.category_id,
      base_price: 0, // deprecated: prices live in prices_version per tier
      image_url: str(formData, "image_url"),
      active: true,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  if (!inserted) throw new Error("Failed to create product");

  const today = new Date().toISOString().slice(0, 10);
  const priceRows = [
    priceHigh > 0 && { product_id: inserted.id, pricing_tier: "high", price: priceHigh, valid_from: today },
    priceMedium > 0 && { product_id: inserted.id, pricing_tier: "medium", price: priceMedium, valid_from: today },
    priceLow > 0 && { product_id: inserted.id, pricing_tier: "low", price: priceLow, valid_from: today },
  ].filter(Boolean) as Array<{
    product_id: string;
    pricing_tier: string;
    price: number;
    valid_from: string;
  }>;
  if (priceRows.length) {
    const { error: priceErr } = await supabase.from("prices_version").insert(priceRows);
    if (priceErr) throw new Error(priceErr.message);
  }

  const cost = num(formData, "cost_price");
  if (cost > 0) {
    await supabase.from("product_costs").upsert({
      product_id: inserted.id,
      cost_price: cost,
      updated_at: new Date().toISOString(),
    });
  }

  revalidatePath("/admin/products");
}

export async function updateProduct(formData: FormData) {
  await requireCapabilityOrAdmin("admin.manage_products");
  const id = String(formData.get("id"));
  if (!id) throw new Error("Missing product id");

  const supabase = createClient();
  // Category stays mandatory on edit too (never unset to free text / empty).
  const categoryId = str(formData, "category_id");
  if (!categoryId) throw new Error("Please select a category");
  const cat = await resolveCategory(supabase, categoryId);
  if (!cat.category_id) throw new Error("Please select a category");
  const payload: Record<string, any> = {
    name: str(formData, "name"),
    sku: str(formData, "sku"),
    category: cat.category,
    category_id: cat.category_id,
    image_url: str(formData, "image_url"),
    active: formData.get("active") === "on",
  };
  const { error } = await supabase.from("products").update(payload).eq("id", id);
  if (error) throw new Error(error.message);

  const cost = num(formData, "cost_price");
  await supabase.from("product_costs").upsert({
    product_id: id,
    cost_price: cost,
    updated_at: new Date().toISOString(),
  });

  revalidatePath(`/admin/products/${id}`);
  revalidatePath("/admin/products");
}

export async function deleteProduct(formData: FormData) {
  await requireCapabilityOrAdmin("admin.manage_products");
  const id = String(formData.get("id"));
  if (!id) throw new Error("Missing product id");

  const supabase = createClient();
  const { error } = await supabase.from("products").delete().eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/admin/products");
  redirect("/admin/products");
}

// ---------- Excel-style grid: batch upsert / delete ----------

export type ProductGridRow = {
  id?: string | null;
  name: string;
  sku: string | null;
  category_id: string | null;
  active?: boolean;
};

export type ProductGridResult = {
  created: number;
  updated: number;
  /** Rows that matched an existing SKU and were updated/re-attached in place. */
  reattached: number;
  deleted: number;
  /** Product ids that could NOT be deleted (FK / other DB error). The grid
   *  restores these rows so the catalog reflects DB truth (no ghosts). */
  failedDeletes: string[];
  errors: string[];
};

export async function saveProductsBatch(
  rows: ProductGridRow[],
  deletedIds: string[]
): Promise<ProductGridResult> {
  await requireCapabilityOrAdmin("admin.manage_products");
  const supabase = createClient();
  const errors: string[] = [];

  // Resolve category names once (denormalized `category` text stays in sync).
  const { data: cats } = await supabase.from("product_categories").select("id, name");
  const catName = new Map<string, string>();
  for (const c of cats ?? []) catName.set(c.id, c.name);

  // Names for human-readable delete-error messages.
  const idsToDelete = deletedIds.filter(Boolean);
  const delName = new Map<string, string>();
  if (idsToDelete.length) {
    const { data: dn } = await supabase
      .from("products")
      .select("id, name")
      .in("id", idsToDelete);
    for (const p of dn ?? []) delName.set(p.id, p.name);
  }

  let deleted = 0;
  const failedDeletes: string[] = [];
  for (const id of idsToDelete) {
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) {
      failedDeletes.push(id);
      const label = delName.get(id) ?? id.slice(0, 8);
      // 23503 = FK violation: the product is still referenced by a historical
      // document line (quotation / order / task list). Surface a clear, actionable
      // message instead of a raw constraint string.
      const isFk =
        (error as any).code === "23503" ||
        /foreign key|still referenced|violates/i.test(error.message ?? "");
      errors.push(
        isFk
          ? `Can’t delete “${label}” — it’s used in existing quotations, orders or production task lists. Set it Inactive instead, or apply migration 089 (product snapshot) to enable safe deletion that preserves those documents.`
          : `Delete failed for “${label}”: ${error.message}`
      );
    } else deleted++;
  }

  // SKU → existing product id (case-insensitive). SKUs are globally unique
  // (products_sku_lower_unique_idx) and a product can be uncategorized after
  // its category was deleted (FK on delete set null). So a "new" grid row
  // whose SKU already exists must UPDATE/re-attach that product, not INSERT —
  // otherwise the unique index throws "duplicate key … products_sku_lower_unique_idx".
  const skuToId = new Map<string, string>();
  {
    const { data: existing } = await supabase.from("products").select("id, sku").not("sku", "is", null);
    for (const p of existing ?? []) if (p.sku) skuToId.set(String(p.sku).trim().toLowerCase(), p.id);
  }

  let created = 0;
  let updated = 0;
  let reattached = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const name = (r.name ?? "").trim();
    if (!name) {
      // Skip fully-blank rows silently; flag rows that have data but no name.
      if (r.sku || r.category_id) errors.push(`Row ${i + 1}: name is required`);
      continue;
    }
    if (!r.category_id) {
      errors.push(`Row ${i + 1} (${name}): category is required`);
      continue;
    }
    const sku = r.sku?.trim() || null;
    const payload: Record<string, any> = {
      name,
      sku,
      category_id: r.category_id,
      category: catName.get(r.category_id) ?? null,
      active: r.active ?? true,
    };

    // Resolve the target: explicit id → existing SKU match → otherwise insert.
    const skuMatchId = sku ? skuToId.get(sku.toLowerCase()) : undefined;
    const targetId = r.id ?? skuMatchId ?? null;

    if (targetId) {
      const { error } = await supabase.from("products").update(payload).eq("id", targetId);
      if (error) errors.push(`Row ${i + 1} (${name}): ${error.message}`);
      else if (r.id) updated++;
      else reattached++; // matched by SKU (re-attached an orphaned/uncategorized product)
    } else {
      const { data: ins, error } = await supabase
        .from("products")
        .insert({ ...payload, base_price: 0 })
        .select("id")
        .single();
      if (error || !ins) {
        errors.push(`Row ${i + 1} (${name}): ${error?.message ?? "insert failed"}`);
      } else {
        created++;
        if (sku) skuToId.set(sku.toLowerCase(), ins.id); // guard against dup SKU within this batch
      }
    }
  }

  revalidatePath("/admin/products");
  revalidatePath("/admin/products/grid");
  return { created, updated, reattached, deleted, failedDeletes, errors };
}

// ---------- options ----------

export async function addOption(formData: FormData) {
  await requireCapabilityOrAdmin("admin.manage_products");
  const product_id = String(formData.get("product_id"));
  if (!product_id) throw new Error("Missing product id");

  const option_type = str(formData, "option_type");
  const option_value = str(formData, "option_value");
  if (!option_type || !option_value)
    throw new Error("Option type and value are required");

  const supabase = createClient();
  const { error } = await supabase.from("options").insert({
    product_id,
    option_type,
    option_value,
    price_modifier: num(formData, "price_modifier"),
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/admin/products/${product_id}`);
}

export async function deleteOption(formData: FormData) {
  await requireCapabilityOrAdmin("admin.manage_products");
  const id = String(formData.get("id"));
  const product_id = String(formData.get("product_id"));
  if (!id) throw new Error("Missing option id");

  const supabase = createClient();
  const { error } = await supabase.from("options").delete().eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath(`/admin/products/${product_id}`);
}

// ---------- prices ----------

export async function addPriceVersion(formData: FormData) {
  await requireCapabilityOrAdmin("admin.manage_products");
  const product_id = String(formData.get("product_id"));
  if (!product_id) throw new Error("Missing product id");

  const valid_from = str(formData, "valid_from");
  const tierRaw = str(formData, "pricing_tier");
  const pricing_tier =
    tierRaw === "high" || tierRaw === "medium" || tierRaw === "low"
      ? tierRaw
      : "medium";

  const supabase = createClient();
  const { error } = await supabase.from("prices_version").insert({
    product_id,
    price: num(formData, "price"),
    valid_from: valid_from ?? new Date().toISOString().slice(0, 10),
    pricing_tier,
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/admin/products/${product_id}`);
}

// ---------- bulk import (idempotent, SKU-keyed upsert) ----------

export type ProductImportRow = {
  sku: string;
  name?: string;
  category?: string | null;
  image_url?: string | null;
  cost_price?: number;
  active?: boolean;
};

export type PriceImportRow = {
  sku: string;
  pricing_tier: "high" | "medium" | "low";
  price: number;
  valid_from?: string;
};

export type OptionImportRow = {
  sku: string;
  option_type: string;
  option_value: string;
  price_modifier?: number;
};

export type ImportResult = {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
  unmatched_skus?: string[];
};

function normKey(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

async function fetchSkuMap(supabase: ReturnType<typeof createClient>) {
  const { data, error } = await supabase
    .from("products")
    .select("id, sku")
    .not("sku", "is", null);
  if (error) throw new Error(error.message);
  const map = new Map<string, string>();
  for (const p of data ?? []) {
    if (p.sku) map.set(normKey(p.sku), p.id);
  }
  return map;
}

// ----- importProducts: upsert by lower(sku) -----

export async function importProducts(
  rows: ProductImportRow[]
): Promise<ImportResult> {
  await requireCapabilityOrAdmin("admin.manage_products");
  const supabase = createClient();

  const valid: ProductImportRow[] = [];
  const errors: string[] = [];
  rows.forEach((r, i) => {
    const sku = (r.sku ?? "").trim();
    if (!sku) {
      errors.push(`Row ${i + 1}: missing sku`);
      return;
    }
    valid.push({ ...r, sku });
  });

  if (valid.length === 0) {
    return { created: 0, updated: 0, skipped: rows.length, errors };
  }

  const skuMap = await fetchSkuMap(supabase);

  let created = 0;
  let updated = 0;
  const nowIso = new Date().toISOString();

  for (let i = 0; i < valid.length; i++) {
    const row = valid[i];
    const key = normKey(row.sku);
    const existingId = skuMap.get(key);

    if (existingId) {
      const updatePayload: Record<string, any> = {};
      if (row.name && row.name.trim()) updatePayload.name = row.name.trim();
      if (row.category !== undefined)
        updatePayload.category = row.category?.trim() || null;
      if (row.image_url !== undefined)
        updatePayload.image_url = row.image_url?.trim() || null;
      if (row.active !== undefined) updatePayload.active = row.active;
      updatePayload.sku = row.sku; // normalize casing/whitespace as provided

      if (Object.keys(updatePayload).length) {
        const { error } = await supabase
          .from("products")
          .update(updatePayload)
          .eq("id", existingId);
        if (error) {
          errors.push(`Row ${i + 1} (${row.sku}): ${error.message}`);
          continue;
        }
      }
      if (row.cost_price !== undefined && row.cost_price >= 0) {
        const { error } = await supabase.from("product_costs").upsert({
          product_id: existingId,
          cost_price: row.cost_price,
          updated_at: nowIso,
        });
        if (error) {
          errors.push(`Row ${i + 1} (${row.sku}) cost: ${error.message}`);
          continue;
        }
      }
      updated++;
    } else {
      if (!row.name || !row.name.trim()) {
        errors.push(`Row ${i + 1} (${row.sku}): name required for new product`);
        continue;
      }
      const { data: ins, error } = await supabase
        .from("products")
        .insert({
          name: row.name.trim(),
          sku: row.sku,
          category: row.category?.trim() || null,
          image_url: row.image_url?.trim() || null,
          base_price: 0,
          active: row.active ?? true,
        })
        .select("id")
        .single();
      if (error || !ins) {
        errors.push(`Row ${i + 1} (${row.sku}): ${error?.message ?? "insert failed"}`);
        continue;
      }
      skuMap.set(key, ins.id);
      if (row.cost_price !== undefined && row.cost_price > 0) {
        await supabase.from("product_costs").upsert({
          product_id: ins.id,
          cost_price: row.cost_price,
          updated_at: nowIso,
        });
      }
      created++;
    }
  }

  revalidatePath("/admin/products");
  return {
    created,
    updated,
    skipped: rows.length - valid.length,
    errors,
  };
}

// ----- importPrices: upsert by (product_id, pricing_tier, valid_from) -----

export async function importPrices(
  rows: PriceImportRow[]
): Promise<ImportResult> {
  await requireCapabilityOrAdmin("admin.manage_products");
  const supabase = createClient();

  const valid: PriceImportRow[] = [];
  const errors: string[] = [];
  const unmatched = new Set<string>();

  rows.forEach((r, i) => {
    if (!r.sku?.trim()) {
      errors.push(`Row ${i + 1}: missing sku`);
      return;
    }
    const tier = (r.pricing_tier ?? "").toLowerCase();
    if (tier !== "high" && tier !== "medium" && tier !== "low") {
      errors.push(`Row ${i + 1} (${r.sku}): invalid pricing_tier`);
      return;
    }
    if (!(typeof r.price === "number" && r.price >= 0)) {
      errors.push(`Row ${i + 1} (${r.sku}): invalid price`);
      return;
    }
    valid.push({
      sku: r.sku.trim(),
      pricing_tier: tier as "high" | "medium" | "low",
      price: r.price,
      valid_from: r.valid_from?.trim() || new Date().toISOString().slice(0, 10),
    });
  });

  if (valid.length === 0) {
    return {
      created: 0,
      updated: 0,
      skipped: rows.length,
      errors,
      unmatched_skus: [],
    };
  }

  const skuMap = await fetchSkuMap(supabase);

  // Resolve SKUs → product_ids; split rows with missing products.
  const resolved: Array<PriceImportRow & { product_id: string }> = [];
  for (const r of valid) {
    const pid = skuMap.get(normKey(r.sku));
    if (!pid) {
      unmatched.add(r.sku);
      continue;
    }
    resolved.push({ ...r, product_id: pid });
  }

  // Fetch existing matching rows so we can pick update vs insert.
  const productIds = Array.from(new Set(resolved.map((r) => r.product_id)));
  const existingKey = new Map<string, string>(); // pid:tier:valid_from -> id
  if (productIds.length) {
    const { data, error } = await supabase
      .from("prices_version")
      .select("id, product_id, pricing_tier, valid_from")
      .in("product_id", productIds);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      existingKey.set(
        `${row.product_id}:${row.pricing_tier}:${row.valid_from}`,
        row.id
      );
    }
  }

  let created = 0;
  let updated = 0;

  for (const r of resolved) {
    const key = `${r.product_id}:${r.pricing_tier}:${r.valid_from}`;
    const existingId = existingKey.get(key);
    if (existingId) {
      const { error } = await supabase
        .from("prices_version")
        .update({ price: r.price })
        .eq("id", existingId);
      if (error) errors.push(`${r.sku} ${r.pricing_tier} ${r.valid_from}: ${error.message}`);
      else updated++;
    } else {
      const { error } = await supabase.from("prices_version").insert({
        product_id: r.product_id,
        pricing_tier: r.pricing_tier,
        price: r.price,
        valid_from: r.valid_from,
      });
      if (error) errors.push(`${r.sku} ${r.pricing_tier} ${r.valid_from}: ${error.message}`);
      else created++;
    }
  }

  revalidatePath("/admin/products");
  return {
    created,
    updated,
    skipped: rows.length - valid.length + unmatched.size,
    errors,
    unmatched_skus: Array.from(unmatched),
  };
}

// ----- importOptions: upsert by (product_id, option_type, option_value) -----

export async function importOptions(
  rows: OptionImportRow[]
): Promise<ImportResult> {
  await requireCapabilityOrAdmin("admin.manage_products");
  const supabase = createClient();

  const valid: OptionImportRow[] = [];
  const errors: string[] = [];
  const unmatched = new Set<string>();

  rows.forEach((r, i) => {
    if (!r.sku?.trim()) {
      errors.push(`Row ${i + 1}: missing sku`);
      return;
    }
    if (!r.option_type?.trim() || !r.option_value?.trim()) {
      errors.push(`Row ${i + 1} (${r.sku}): option_type and option_value required`);
      return;
    }
    valid.push({
      sku: r.sku.trim(),
      option_type: r.option_type.trim(),
      option_value: r.option_value.trim(),
      price_modifier:
        typeof r.price_modifier === "number" && !Number.isNaN(r.price_modifier)
          ? r.price_modifier
          : 0,
    });
  });

  if (valid.length === 0) {
    return {
      created: 0,
      updated: 0,
      skipped: rows.length,
      errors,
      unmatched_skus: [],
    };
  }

  const skuMap = await fetchSkuMap(supabase);

  const resolved: Array<OptionImportRow & { product_id: string }> = [];
  for (const r of valid) {
    const pid = skuMap.get(normKey(r.sku));
    if (!pid) {
      unmatched.add(r.sku);
      continue;
    }
    resolved.push({ ...r, product_id: pid });
  }

  const productIds = Array.from(new Set(resolved.map((r) => r.product_id)));
  const existingKey = new Map<string, string>(); // pid:type:value -> id
  if (productIds.length) {
    const { data, error } = await supabase
      .from("options")
      .select("id, product_id, option_type, option_value")
      .in("product_id", productIds);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      existingKey.set(
        `${row.product_id}:${row.option_type.toLowerCase()}:${row.option_value.toLowerCase()}`,
        row.id
      );
    }
  }

  let created = 0;
  let updated = 0;

  for (const r of resolved) {
    const key = `${r.product_id}:${r.option_type.toLowerCase()}:${r.option_value.toLowerCase()}`;
    const existingId = existingKey.get(key);
    if (existingId) {
      const { error } = await supabase
        .from("options")
        .update({ price_modifier: r.price_modifier })
        .eq("id", existingId);
      if (error) errors.push(`${r.sku} ${r.option_type}/${r.option_value}: ${error.message}`);
      else updated++;
    } else {
      const { error } = await supabase.from("options").insert({
        product_id: r.product_id,
        option_type: r.option_type,
        option_value: r.option_value,
        price_modifier: r.price_modifier ?? 0,
      });
      if (error) errors.push(`${r.sku} ${r.option_type}/${r.option_value}: ${error.message}`);
      else created++;
    }
  }

  revalidatePath("/admin/products");
  return {
    created,
    updated,
    skipped: rows.length - valid.length + unmatched.size,
    errors,
    unmatched_skus: Array.from(unmatched),
  };
}

export async function deletePriceVersion(formData: FormData) {
  await requireCapabilityOrAdmin("admin.manage_products");
  const id = String(formData.get("id"));
  const product_id = String(formData.get("product_id"));
  if (!id) throw new Error("Missing price id");

  const supabase = createClient();
  const { error } = await supabase.from("prices_version").delete().eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath(`/admin/products/${product_id}`);
}
