"use server";

/**
 * Pricing engine server actions (v5 — single-category saved price lists).
 *
 * Model: a price list is a SAVED OBJECT = one product category + one set of
 * tier margins + a name + effective date + cost-version reference + a status
 * (draft / published / archived). Many lists can exist per category.
 *
 * Separation:
 *   - Cost entry (finance): RMB costs only, versioned.
 *   - Pricing (admin): create price lists from costs, preview, publish, assign.
 *   - Quote builder (sales): uses the seller's assigned PUBLISHED list per category.
 *
 * Publishing writes computed prices into prices_version (the seam the CSV
 * upload fed) under the list's id; only published lists are used in quotes.
 */

import { createClient } from "@/lib/supabase/server";
import { getCurrentUserRole } from "@/lib/auth";
import { requireCapabilityOrAdmin } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  computePricing,
  round,
  isThinMargin,
  type PricingSettings,
  type TargetMargins,
} from "@/lib/pricing-engine";
import { naturalProductSort } from "@/lib/product-sort";
import { resolveUserLabelStrings } from "@/lib/user-display";
import type { PriceList, PriceListAssignment, PriceListAssigneeType, PriceListStatus } from "@/lib/types";

// ---------------------------- helpers ----------------------------

function num(fd: FormData, key: string, fallback = 0): number {
  const v = fd.get(key);
  if (!v || String(v).trim() === "") return fallback;
  const n = Number(String(v).replace(",", "."));
  if (!Number.isFinite(n)) throw new Error(`Invalid number for ${key}`);
  return n;
}

function str(fd: FormData, key: string): string | null {
  const v = fd.get(key);
  return v == null ? null : String(v).trim() || null;
}

const FALLBACK_SETTINGS: PricingSettings = { exchangeRate: 6.85, taxRebate: 0.1 };

async function loadSettings(
  supabase: ReturnType<typeof createClient>
): Promise<{ settings: PricingSettings; thinThreshold: number }> {
  const { data } = await supabase
    .from("pricing_settings")
    .select("exchange_rate, tax_rebate, thin_margin_threshold")
    .limit(1)
    .single();
  if (!data) return { settings: FALLBACK_SETTINGS, thinThreshold: 0.2 };
  return {
    settings: { exchangeRate: Number(data.exchange_rate), taxRebate: Number(data.tax_rebate) },
    thinThreshold: Number(data.thin_margin_threshold ?? 0.2),
  };
}

function marginsOf(list: { target_margin1: any; target_margin2: any; target_margin3: any }): TargetMargins {
  return {
    targetMargin1: Number(list.target_margin1),
    targetMargin2: Number(list.target_margin2),
    targetMargin3: Number(list.target_margin3),
  };
}

type ActiveProduct = { id: string; name: string; sku: string | null; categoryId: string | null; categoryName: string | null };

async function fetchActiveProducts(supabase: ReturnType<typeof createClient>): Promise<ActiveProduct[]> {
  const { data } = await supabase
    .from("products")
    .select("id, name, sku, category, category_id")
    .eq("active", true)
    .order("name");
  // Natural business order (model number ascending, standard before IoT) so the
  // cost-entry paste-a-column workflow and every pricing table line up with the
  // Excel cost file. This is the single chokepoint feeding cost entry, the price
  // list builder, its preview, and the detail rows.
  return ((data ?? []) as any[])
    .map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku ?? null,
      categoryId: p.category_id ?? null,
      categoryName: p.category ?? null,
    }))
    .sort(naturalProductSort);
}

async function costMap(supabase: ReturnType<typeof createClient>): Promise<Map<string, number>> {
  const { data } = await supabase.from("product_costs").select("product_id, cost_rmb");
  const m = new Map<string, number>();
  for (const c of data ?? []) m.set(c.product_id, Number(c.cost_rmb ?? 0));
  return m;
}

const TIERS: Array<{ ptier: "high" | "medium" | "low"; key: "tier1" | "tier2" | "tier3" }> = [
  { ptier: "high", key: "tier1" },
  { ptier: "medium", key: "tier2" },
  { ptier: "low", key: "tier3" },
];

// ---------------------------- settings ----------------------------

export async function updateSettings(formData: FormData) {
  await requireCapabilityOrAdmin("pricing.manage");
  const { userId } = await getCurrentUserRole();
  const supabase = createClient();
  const { data: row } = await supabase.from("pricing_settings").select("id").limit(1).single();
  const payload = {
    exchange_rate: num(formData, "exchangeRate", 6.85),
    tax_rebate: num(formData, "taxRebate", 0.1),
    thin_margin_threshold: num(formData, "thinMarginThreshold", 0.2),
    updated_at: new Date().toISOString(),
    updated_by: userId ?? null,
  };
  const { error } = row?.id
    ? await supabase.from("pricing_settings").update(payload).eq("id", row.id)
    : await supabase.from("pricing_settings").insert(payload);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/pricing", "layout");
}

// ---------------------------- price list CRUD (v5) ----------------------------

export async function createPriceList(formData: FormData): Promise<void> {
  await requireCapabilityOrAdmin("pricing.manage");
  const { userId } = await getCurrentUserRole();
  const supabase = createClient();
  const name = str(formData, "name");
  const categoryId = str(formData, "categoryId");
  if (!name) throw new Error("Price list name is required");
  if (!categoryId) throw new Error("Please select a product category");
  const { data: created, error } = await supabase
    .from("price_lists")
    .insert({
      name,
      category_id: categoryId,
      target_margin1: num(formData, "targetMargin1", 0.38),
      target_margin2: num(formData, "targetMargin2", 0.36),
      target_margin3: num(formData, "targetMargin3", 0.25),
      effective_date: str(formData, "effectiveDate"),
      notes: str(formData, "notes"),
      cost_batch_id: str(formData, "costBatchId"),
      status: "draft",
      is_default: false,
      created_by: userId ?? null,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/admin/pricing", "layout");
  // Creation is <5% of the workflow — drop the user straight into the new
  // list's detail workspace to configure / assign / publish it.
  redirect(`/admin/pricing/${created.id}`);
}

export async function updatePriceList(formData: FormData) {
  await requireCapabilityOrAdmin("pricing.manage");
  const { userId } = await getCurrentUserRole();
  const supabase = createClient();
  const id = str(formData, "id");
  if (!id) throw new Error("Missing price list id");
  const payload: Record<string, any> = {
    name: str(formData, "name"),
    target_margin1: num(formData, "targetMargin1", 0.38),
    target_margin2: num(formData, "targetMargin2", 0.36),
    target_margin3: num(formData, "targetMargin3", 0.25),
    updated_at: new Date().toISOString(),
    updated_by: userId ?? null,
  };
  if (formData.has("effectiveDate")) payload.effective_date = str(formData, "effectiveDate");
  if (formData.has("notes")) payload.notes = str(formData, "notes");
  if (formData.has("categoryId")) payload.category_id = str(formData, "categoryId");
  const { error } = await supabase.from("price_lists").update(payload).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/pricing", "layout");
}

async function setStatus(id: string, status: PriceListStatus) {
  const supabase = createClient();
  const { error } = await supabase.from("price_lists").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function archivePriceList(formData: FormData) {
  await requireCapabilityOrAdmin("pricing.manage");
  const id = str(formData, "id");
  if (!id) throw new Error("Missing price list id");
  await setStatus(id, "archived");
  revalidatePath("/admin/pricing", "layout");
}

export async function unpublishPriceList(formData: FormData) {
  await requireCapabilityOrAdmin("pricing.manage");
  const id = str(formData, "id");
  if (!id) throw new Error("Missing price list id");
  await setStatus(id, "draft");
  revalidatePath("/admin/pricing", "layout");
}

export async function deletePriceList(formData: FormData) {
  await requireCapabilityOrAdmin("pricing.manage");
  const supabase = createClient();
  const id = str(formData, "id");
  if (!id) throw new Error("Missing price list id");
  const { error } = await supabase.from("price_lists").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/pricing", "layout");
  // The list is gone — its detail page would 404, so land on the Library.
  redirect("/admin/pricing/library");
}

export async function duplicatePriceList(formData: FormData) {
  await requireCapabilityOrAdmin("pricing.manage");
  const { userId } = await getCurrentUserRole();
  const supabase = createClient();
  const id = str(formData, "id");
  if (!id) throw new Error("Missing price list id");
  const { data: src } = await supabase.from("price_lists").select("*").eq("id", id).maybeSingle();
  if (!src) throw new Error("Price list not found");
  const { data: copy, error } = await supabase
    .from("price_lists")
    .insert({
      name: `${(src as any).name} (copy)`,
      category_id: (src as any).category_id ?? null,
      target_margin1: (src as any).target_margin1,
      target_margin2: (src as any).target_margin2,
      target_margin3: (src as any).target_margin3,
      effective_date: (src as any).effective_date ?? null,
      notes: (src as any).notes ?? null,
      cost_batch_id: (src as any).cost_batch_id ?? null,
      status: "draft",
      is_default: false,
      created_by: userId ?? null,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/admin/pricing", "layout");
  // Open the fresh copy so the admin can tweak / assign / publish it.
  redirect(`/admin/pricing/${copy.id}`);
}

// ---------------------------- assignments ----------------------------

export async function addAssignment(formData: FormData) {
  await requireCapabilityOrAdmin("pricing.manage");
  const supabase = createClient();
  const priceListId = str(formData, "priceListId");
  const assigneeType = str(formData, "assigneeType") as PriceListAssigneeType | null;
  if (!priceListId || !assigneeType) throw new Error("Price list and assignee type are required");
  if (!["team", "group", "seller"].includes(assigneeType)) throw new Error("Invalid assignee type");
  const { error } = await supabase.from("price_list_assignments").insert({
    price_list_id: priceListId,
    assignee_type: assigneeType,
    assignee_id: str(formData, "assigneeId"),
    assignee_name: str(formData, "assigneeName"),
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/pricing", "layout");
}

export async function removeAssignment(formData: FormData) {
  await requireCapabilityOrAdmin("pricing.manage");
  const supabase = createClient();
  const id = str(formData, "id");
  if (!id) throw new Error("Missing assignment id");
  const { error } = await supabase.from("price_list_assignments").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/pricing", "layout");
}

// ---------------------------- costs (finance) — versioned ----------------------------

export type CostEntry = { productId: string; costRmb: number };
export type CostBatchOpts = { categoryId?: string | null; effectiveDate?: string | null; note?: string | null };

export async function saveCostBatch(entries: CostEntry[], opts: CostBatchOpts = {}) {
  await requireCapabilityOrAdmin("pricing.manage_costs");
  const { userId } = await getCurrentUserRole();
  if (!entries.length) return { changed: 0 };
  const supabase = createClient();
  const now = new Date().toISOString();
  const effectiveDate = opts.effectiveDate || now.slice(0, 10);

  const ids = entries.map((e) => e.productId);
  const { data: existing } = await supabase.from("product_costs").select("product_id, cost_rmb").in("product_id", ids);
  const existingMap = new Map<string, number>();
  for (const r of existing ?? []) existingMap.set(r.product_id, Number(r.cost_rmb ?? 0));

  const changedEntries = entries.filter((e) => (existingMap.get(e.productId) ?? 0) !== e.costRmb);

  const { error } = await supabase
    .from("product_costs")
    .upsert(entries.map((e) => ({ product_id: e.productId, cost_rmb: e.costRmb, updated_at: now })), { onConflict: "product_id" });
  if (error) throw new Error(error.message);

  if (changedEntries.length === 0) {
    revalidatePath("/cost-entry");
    return { changed: 0 };
  }

  let batchId: string | null = null;
  try {
    const { data: batch } = await supabase
      .from("cost_batches")
      .insert({ category_id: opts.categoryId ?? null, effective_date: effectiveDate, note: opts.note ?? null, created_by: userId ?? null })
      .select("id")
      .single();
    batchId = (batch as any)?.id ?? null;
  } catch {
    batchId = null;
  }

  const histErr = (
    await supabase.from("cost_rmb_history").insert(
      changedEntries.map((e) => ({
        product_id: e.productId,
        old_cost_rmb: existingMap.get(e.productId) ?? null,
        new_cost_rmb: e.costRmb,
        changed_by: userId ?? null,
        changed_at: now,
        ...(batchId ? { batch_id: batchId, effective_date: effectiveDate } : {}),
      }))
    )
  ).error;
  if (histErr) {
    await supabase.from("cost_rmb_history").insert(
      changedEntries.map((e) => ({
        product_id: e.productId,
        old_cost_rmb: existingMap.get(e.productId) ?? null,
        new_cost_rmb: e.costRmb,
        changed_by: userId ?? null,
        changed_at: now,
      }))
    );
  }

  revalidatePath("/cost-entry");
  revalidatePath("/admin/pricing", "layout");
  return { changed: changedEntries.length };
}

// ---------------------------- publish + CSV (per single-category list) ----------------------------

/** Products this list prices: its category (or all products for a legacy null-category list). */
async function listProducts(
  supabase: ReturnType<typeof createClient>,
  list: { category_id?: string | null }
): Promise<ActiveProduct[]> {
  const all = await fetchActiveProducts(supabase);
  return list.category_id ? all.filter((p) => p.categoryId === list.category_id) : all;
}

export async function publishPrices(
  priceListId: string
): Promise<{ published: number; skipped: number; skippedNames: string[] }> {
  await requireCapabilityOrAdmin("pricing.manage");
  const supabase = createClient();
  const { settings } = await loadSettings(supabase);
  const { data: list } = await supabase.from("price_lists").select("*").eq("id", priceListId).maybeSingle();
  if (!list) throw new Error("Price list not found");
  const margins = marginsOf(list as any);

  const [products, costs] = await Promise.all([listProducts(supabase, list as any), costMap(supabase)]);
  const costed = products.filter((p) => (costs.get(p.id) ?? 0) > 0);
  // Products in the category with no active cost are NOT published (we never
  // write a $0 price into the quote builder). Report them so the admin sees
  // exactly what was left out instead of a silent skip.
  const skipped = products.filter((p) => (costs.get(p.id) ?? 0) <= 0);

  const today = new Date().toISOString().slice(0, 10);
  if (costed.length) {
    const productIds = costed.map((p) => p.id);
    const { data: existing } = await supabase
      .from("prices_version")
      .select("id, product_id, pricing_tier")
      .in("product_id", productIds)
      .eq("valid_from", today)
      .eq("price_list_id", priceListId);
    const existingKey = new Map<string, string>();
    for (const r of existing ?? []) existingKey.set(`${r.product_id}:${r.pricing_tier}`, r.id);

    for (const p of costed) {
      const r = computePricing(costs.get(p.id) ?? 0, settings, margins);
      for (const { ptier, key } of TIERS) {
        const price = round(r[key].price);
        const existingId = existingKey.get(`${p.id}:${ptier}`);
        if (existingId) await supabase.from("prices_version").update({ price }).eq("id", existingId);
        else
          await supabase.from("prices_version").insert({
            product_id: p.id,
            pricing_tier: ptier,
            price,
            valid_from: today,
            price_list_id: priceListId,
          });
      }
    }
  }

  await setStatus(priceListId, "published");
  revalidatePath("/admin/pricing", "layout");
  return {
    published: costed.length,
    skipped: skipped.length,
    skippedNames: skipped.map((p) => p.name),
  };
}

export async function getPriceCsv(priceListId: string): Promise<string> {
  await requireCapabilityOrAdmin("pricing.manage_costs");
  const supabase = createClient();
  const { settings } = await loadSettings(supabase);
  const { data: list } = await supabase.from("price_lists").select("*").eq("id", priceListId).maybeSingle();
  if (!list) throw new Error("Price list not found");
  const margins = marginsOf(list as any);
  const [products, costs] = await Promise.all([listProducts(supabase, list as any), costMap(supabase)]);
  const today = new Date().toISOString().slice(0, 10);
  const lines = ["sku,pricing_tier,price,valid_from"];
  for (const p of products) {
    if (!p.sku || (costs.get(p.id) ?? 0) <= 0) continue;
    const r = computePricing(costs.get(p.id)!, settings, margins);
    lines.push(`${p.sku},high,${round(r.tier1.price)},${today}`);
    lines.push(`${p.sku},medium,${round(r.tier2.price)},${today}`);
    lines.push(`${p.sku},low,${round(r.tier3.price)},${today}`);
  }
  return lines.join("\n");
}

// ---------------------------- bulk actions (library) ----------------------------
// Called from the Price List Library selection toolbar (client → JS args).

export async function bulkArchivePriceLists(ids: string[]): Promise<void> {
  await requireCapabilityOrAdmin("pricing.manage");
  if (!ids.length) return;
  const supabase = createClient();
  const { error } = await supabase
    .from("price_lists")
    .update({ status: "archived", updated_at: new Date().toISOString() })
    .in("id", ids);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/pricing", "layout");
}

export async function bulkDeletePriceLists(ids: string[]): Promise<void> {
  await requireCapabilityOrAdmin("pricing.manage");
  if (!ids.length) return;
  const supabase = createClient();
  const { error } = await supabase.from("price_lists").delete().in("id", ids);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/pricing", "layout");
}

export async function bulkPublishPriceLists(
  ids: string[]
): Promise<{ published: number }> {
  await requireCapabilityOrAdmin("pricing.manage");
  let published = 0;
  for (const id of ids) {
    const r = await publishPrices(id); // recomputes + writes prices_version per list
    published += r.published;
  }
  revalidatePath("/admin/pricing", "layout");
  return { published };
}

export async function bulkAssignSeller(
  ids: string[],
  sellerId: string,
  sellerName: string
): Promise<void> {
  await requireCapabilityOrAdmin("pricing.manage");
  if (!ids.length || !sellerId) return;
  const supabase = createClient();
  const rows = ids.map((price_list_id) => ({
    price_list_id,
    assignee_type: "seller" as const,
    assignee_id: sellerId,
    assignee_name: sellerName || null,
  }));
  const { error } = await supabase.from("price_list_assignments").insert(rows);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/pricing", "layout");
}

export async function bulkDuplicatePriceLists(ids: string[]): Promise<void> {
  await requireCapabilityOrAdmin("pricing.manage");
  if (!ids.length) return;
  const { userId } = await getCurrentUserRole();
  const supabase = createClient();
  const { data: srcs } = await supabase.from("price_lists").select("*").in("id", ids);
  if (!srcs?.length) return;
  const rows = (srcs as any[]).map((s) => ({
    name: `${s.name} (copy)`,
    category_id: s.category_id ?? null,
    target_margin1: s.target_margin1,
    target_margin2: s.target_margin2,
    target_margin3: s.target_margin3,
    effective_date: s.effective_date ?? null,
    notes: s.notes ?? null,
    cost_batch_id: s.cost_batch_id ?? null,
    status: "draft" as const,
    is_default: false,
    created_by: userId ?? null,
  }));
  const { error } = await supabase.from("price_lists").insert(rows);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/pricing", "layout");
}

// ---------------------------- page data ----------------------------

export type CostVersion = { id: string; label: string };
export type CreateProduct = { id: string; name: string; sku: string | null; categoryId: string | null; costRmb: number; usdCost: number };

export type PriceListRow = PriceList & {
  categoryName: string | null;
  assignments: PriceListAssignment[];
  productCount: number;
  costVersionLabel: string | null;
};

export async function getPricingPageData(): Promise<{
  settings: PricingSettings;
  thinThreshold: number;
  categories: Array<{ id: string; name: string; count: number }>;
  costVersions: CostVersion[];
  products: CreateProduct[];
  lists: PriceListRow[];
}> {
  await requireCapabilityOrAdmin("pricing.manage");
  const supabase = createClient();
  const { settings, thinThreshold } = await loadSettings(supabase);

  const [{ data: cats }, { data: listData }, { data: assignsRaw }, products, costs, { data: batches }] = await Promise.all([
    supabase.from("product_categories").select("id, name").eq("is_template", false).order("position").order("name"),
    supabase.from("price_lists").select("*").order("created_at", { ascending: false }),
    supabase.from("price_list_assignments").select("*").order("created_at", { ascending: false }),
    fetchActiveProducts(supabase),
    costMap(supabase),
    supabase.from("cost_batches").select("id, effective_date, note").order("effective_date", { ascending: false }).order("created_at", { ascending: false }),
  ]);

  const catName = new Map<string, string>();
  for (const c of cats ?? []) catName.set(c.id, c.name);
  const countByCat = new Map<string, number>();
  for (const p of products) if (p.categoryId) countByCat.set(p.categoryId, (countByCat.get(p.categoryId) ?? 0) + 1);

  const byList = new Map<string, PriceListAssignment[]>();
  for (const a of (assignsRaw ?? []) as PriceListAssignment[]) {
    const arr = byList.get(a.price_list_id);
    if (arr) arr.push(a);
    else byList.set(a.price_list_id, [a]);
  }

  const batchLabel = new Map<string, string>();
  const costVersions: CostVersion[] = ((batches ?? []) as any[]).map((b) => {
    const label = `${b.effective_date}${b.note ? ` · ${b.note}` : ""}`;
    batchLabel.set(b.id, label);
    return { id: b.id, label };
  });

  const lists: PriceListRow[] = ((listData ?? []) as PriceList[]).map((l) => ({
    ...l,
    categoryName: l.category_id ? catName.get(l.category_id) ?? null : null,
    assignments: byList.get(l.id) ?? [],
    productCount: l.category_id ? countByCat.get(l.category_id) ?? 0 : products.length,
    costVersionLabel: l.cost_batch_id ? batchLabel.get(l.cost_batch_id) ?? null : null,
  }));

  return {
    settings,
    thinThreshold,
    categories: ((cats ?? []) as any[]).map((c) => ({ id: c.id, name: c.name, count: countByCat.get(c.id) ?? 0 })),
    costVersions,
    products: products.map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      categoryId: p.categoryId,
      costRmb: costs.get(p.id) ?? 0,
      usdCost: round((costs.get(p.id) ?? 0) / settings.exchangeRate),
    })),
    lists,
  };
}

export type DetailRow = {
  id: string;
  name: string;
  sku: string | null;
  costRmb: number;
  usdCost: number;
  tiers: Array<{ price: number; marginPctAfterTax: number; marginValueAfterTax: number; thin: boolean }>;
};

export async function getPriceListDetail(priceListId: string): Promise<{
  list: PriceListRow | null;
  rows: DetailRow[];
} | null> {
  await requireCapabilityOrAdmin("pricing.manage");
  const supabase = createClient();
  const { settings, thinThreshold } = await loadSettings(supabase);
  const { data: list } = await supabase.from("price_lists").select("*").eq("id", priceListId).maybeSingle();
  if (!list) return null;

  const [{ data: cats }, { data: assigns }, products, costs] = await Promise.all([
    supabase.from("product_categories").select("id, name"),
    supabase.from("price_list_assignments").select("*").eq("price_list_id", priceListId),
    listProducts(supabase, list as any),
    costMap(supabase),
  ]);
  const catName = new Map<string, string>();
  for (const c of cats ?? []) catName.set(c.id, c.name);
  const margins = marginsOf(list as any);

  const rows: DetailRow[] = products.map((p) => {
    const costRmb = costs.get(p.id) ?? 0;
    const r = computePricing(costRmb, settings, margins);
    const mk = (t: "tier1" | "tier2" | "tier3") => ({
      price: round(r[t].price),
      marginPctAfterTax: r[t].marginPctAfterTax,
      marginValueAfterTax: round(r[t].marginValueAfterTax),
      thin: isThinMargin(r[t].marginPctAfterTax, thinThreshold),
    });
    return { id: p.id, name: p.name, sku: p.sku, costRmb, usdCost: round(costRmb / settings.exchangeRate), tiers: [mk("tier1"), mk("tier2"), mk("tier3")] };
  });

  let costVersionLabel: string | null = null;
  if ((list as any).cost_batch_id) {
    const { data: batch } = await supabase
      .from("cost_batches")
      .select("effective_date, note")
      .eq("id", (list as any).cost_batch_id)
      .maybeSingle();
    if (batch) costVersionLabel = `${batch.effective_date}${batch.note ? ` · ${batch.note}` : ""}`;
  }

  const row: PriceListRow = {
    ...(list as PriceList),
    categoryName: (list as any).category_id ? catName.get((list as any).category_id) ?? null : null,
    assignments: ((assigns ?? []) as PriceListAssignment[]),
    productCount: rows.length,
    costVersionLabel,
  };

  return { list: row, rows };
}

// ---------------------------- cost entry data (cost-only) ----------------------------

export type CostEntryProduct = {
  id: string;
  name: string;
  sku: string | null;
  categoryId: string | null;
  categoryName: string | null;
  costRmb: number;
  updatedAt: string | null;
};

export async function getCostEntryData(): Promise<{
  categories: Array<{ id: string; name: string; count: number }>;
  products: CostEntryProduct[];
  latestBatch: { effective_date: string; note: string | null; created_at: string } | null;
}> {
  await requireCapabilityOrAdmin("pricing.manage_costs");
  const supabase = createClient();
  const [{ data: cats }, products, { data: costRows }] = await Promise.all([
    supabase.from("product_categories").select("id, name").eq("is_template", false).order("position").order("name"),
    fetchActiveProducts(supabase),
    supabase.from("product_costs").select("product_id, cost_rmb, updated_at"),
  ]);
  const costInfo = new Map<string, { cost: number; updatedAt: string | null }>();
  for (const c of costRows ?? []) costInfo.set(c.product_id, { cost: Number(c.cost_rmb ?? 0), updatedAt: c.updated_at ?? null });

  const countByCat = new Map<string, number>();
  for (const p of products) if (p.categoryId) countByCat.set(p.categoryId, (countByCat.get(p.categoryId) ?? 0) + 1);

  let latestBatch: any = null;
  try {
    const { data } = await supabase
      .from("cost_batches")
      .select("effective_date, note, created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    latestBatch = data ?? null;
  } catch {
    latestBatch = null;
  }

  return {
    categories: ((cats ?? []) as any[]).map((c) => ({ id: c.id, name: c.name, count: countByCat.get(c.id) ?? 0 })),
    products: products.map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      categoryId: p.categoryId,
      categoryName: p.categoryName,
      costRmb: costInfo.get(p.id)?.cost ?? 0,
      updatedAt: costInfo.get(p.id)?.updatedAt ?? null,
    })),
    latestBatch,
  };
}

// ---------------------------- cost versions (audit history) ----------------------------

export type CostVersionEntry = {
  id: string;
  /** 1-based, oldest version = 1 (display newest-first). */
  versionNo: number;
  note: string | null;
  categoryId: string | null;
  /** Resolved category name, or null when the batch spanned all categories. */
  categoryName: string | null;
  /** Number of cost changes recorded for the batch. */
  changeCount: number;
  /** Resolved label of whoever saved it. */
  savedBy: string;
  createdAt: string;
  effectiveDate: string;
};

/**
 * Every saved cost batch, newest first, enriched for the cost-entry version
 * banner + history. Soft-fails to an empty list when the cost-versioning
 * tables (m086) aren't applied yet.
 */
export async function getCostVersions(): Promise<CostVersionEntry[]> {
  await requireCapabilityOrAdmin("pricing.manage_costs");
  const supabase = createClient();

  let batches: any[] = [];
  try {
    const { data } = await supabase
      .from("cost_batches")
      .select("id, category_id, effective_date, note, created_by, created_at")
      .order("created_at", { ascending: true }); // oldest first for stable numbering
    batches = (data ?? []) as any[];
  } catch {
    return [];
  }
  if (batches.length === 0) return [];

  const ids = batches.map((b) => b.id);

  // Change counts per batch (from the cost history rows linked to each batch).
  const countByBatch = new Map<string, number>();
  try {
    const { data: hist } = await supabase.from("cost_rmb_history").select("batch_id").in("batch_id", ids);
    for (const h of (hist ?? []) as any[]) {
      if (h.batch_id) countByBatch.set(h.batch_id, (countByBatch.get(h.batch_id) ?? 0) + 1);
    }
  } catch {
    /* counts are best-effort */
  }

  // Category names for scoped batches.
  const catIds = Array.from(new Set(batches.map((b) => b.category_id).filter(Boolean))) as string[];
  const catName = new Map<string, string>();
  if (catIds.length) {
    const { data: cats } = await supabase.from("product_categories").select("id, name").in("id", catIds);
    for (const c of (cats ?? []) as any[]) catName.set(c.id, c.name);
  }

  const labels = await resolveUserLabelStrings(batches.map((b) => b.created_by));

  return batches
    .map((b, i) => ({
      id: b.id as string,
      versionNo: i + 1,
      note: (b.note ?? null) as string | null,
      categoryId: (b.category_id ?? null) as string | null,
      categoryName: b.category_id ? catName.get(b.category_id) ?? null : null,
      changeCount: countByBatch.get(b.id) ?? 0,
      savedBy: b.created_by ? labels.get(b.created_by) ?? "—" : "—",
      createdAt: b.created_at as string,
      effectiveDate: b.effective_date as string,
    }))
    .reverse(); // newest first for display
}
