// =====================================================================
// lib/packing-server.ts — server-side data access for the packing module.
//
// This is the ADAPTER between the DB (Supabase) and the pure engine
// (lib/packing-core). The engine stays DB-free; this file builds the
// PackingContext it needs. When the ERP integrates the module, only this
// adapter changes — never lib/packing-core.
// =====================================================================
import "server-only";
import { createClient } from "@/lib/supabase/server";
import type {
  PackingConfig,
  ContainerType,
  PackagingSpec,
  PackingContext,
} from "@/lib/packing-core/index.ts";

type SB = ReturnType<typeof createClient>;

const num = (v: unknown): number | null =>
  v == null || v === "" ? null : Number(v);

// ---------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------
export async function getPackingConfig(sb: SB): Promise<PackingConfig> {
  const { data } = await sb.from("packing_config").select("key,value");
  const map = new Map((data ?? []).map((r: any) => [r.key, r.value]));
  return {
    volumetric_factor: Number(map.get("volumetric_factor") ?? 200),
    incomplete_carton_policy:
      (map.get("incomplete_carton_policy") as any) ?? "remaining_individual_cartons",
    pole_forces_40hq_length_mm: Number(map.get("pole_forces_40hq_length_mm") ?? 5500),
    default_safety_margin_pct: Number(map.get("default_safety_margin_pct") ?? 10),
  };
}

// ---------------------------------------------------------------------
// Container types
// ---------------------------------------------------------------------
export async function getContainers(sb: SB): Promise<ContainerType[]> {
  const { data } = await sb
    .from("packing_container_type")
    .select("*")
    .order("code");
  return (data ?? []).map((c: any) => ({
    code: c.code,
    name: c.name,
    internal: { l_mm: num(c.internal_l_mm), w_mm: num(c.internal_w_mm), h_mm: num(c.internal_h_mm) },
    door_w_mm: num(c.door_w_mm),
    door_h_mm: num(c.door_h_mm),
    theoretical_cbm: num(c.theoretical_cbm),
    operational_cbm: num(c.operational_cbm),
    max_payload_kg: num(c.max_payload_kg),
    safety_margin_pct: Number(c.safety_margin_pct ?? 0),
    min_unused_reserve_cbm: num(c.min_unused_reserve_cbm),
    applicable_cbm_min: num(c.applicable_cbm_min),
    applicable_cbm_max: num(c.applicable_cbm_max),
    applicable_families: Array.isArray(c.applicable_families) ? c.applicable_families : [],
    rules_validated: !!c.rules_validated,
    active: !!c.active,
  }));
}

// ---------------------------------------------------------------------
// Packaging specs (current version of every item)
// ---------------------------------------------------------------------
function toSpec(row: any): PackagingSpec {
  const v = row.v;
  return {
    item_id: row.id,
    version_id: v?.id ?? null,
    version_no: v?.version_no ?? null,
    reference: row.reference,
    name: row.name,
    component_name: row.component_name,
    component_type: row.component_type,
    packaging_type: v?.packaging_type ?? null,
    units_per_outside_carton: num(v?.qty_per_outside_carton),
    inner: { l_mm: num(v?.inner_l_mm), w_mm: num(v?.inner_w_mm), h_mm: num(v?.inner_h_mm) },
    outer: { l_mm: num(v?.outer_l_mm), w_mm: num(v?.outer_w_mm), h_mm: num(v?.outer_h_mm) },
    net_weight_kg: num(v?.net_weight_kg),
    gross_weight_unit_kg: num(v?.gross_weight_unit_kg),
    gross_weight_master_kg: num(v?.gross_weight_master_kg),
    is_lamp_pole: !!v?.lamp_pole,
    is_oversized: !!v?.oversized,
    volumetric_factor: num(v?.volumetric_factor),
  };
}

/** Map of item_id → PackagingSpec built from each item's current version. */
export async function getPackagingSpecMap(sb: SB): Promise<Map<string, PackagingSpec>> {
  const { data } = await sb
    .from("packing_item")
    .select(
      "id, reference, name, component_name, component_type, current_version_id, " +
        "v:packing_item_version!packing_item_current_version_fk(*)"
    );
  const map = new Map<string, PackagingSpec>();
  for (const row of (data ?? []) as any[]) {
    // the embedded relation may come back as an array or object
    const v = Array.isArray(row.v) ? row.v[0] : row.v;
    map.set(row.id, toSpec({ ...row, v }));
  }
  return map;
}

/**
 * Build the full engine context. resolveBom applies only VALIDATED BOMs —
 * proposals (needs_validation) are never auto-exploded, so Phase-1 numbers
 * stay honest. Poles added via options are still handled by the engine.
 */
export async function buildPackingContext(): Promise<PackingContext> {
  const sb = createClient();
  const [config, containers, specMap] = await Promise.all([
    getPackingConfig(sb),
    getContainers(sb),
    getPackagingSpecMap(sb),
  ]);

  const { data: boms } = await sb
    .from("packing_bom")
    .select("product_item_id, status, lines:packing_bom_line(component_item_id, qty_per_product, depends_on_option, mandatory)")
    .eq("status", "validated");
  const bomMap = new Map<string, any[]>();
  for (const b of boms ?? []) bomMap.set((b as any).product_item_id, (b as any).lines ?? []);

  return {
    config,
    containers,
    getPackaging: (id) => specMap.get(id) ?? null,
    resolveBom: (productId, options) => {
      const lines = bomMap.get(productId);
      if (!lines || !lines.length) {
        const out: Array<{ component_id: string; qty_per_product: number; label?: string }> = [
          { component_id: productId, qty_per_product: 1 },
        ];
        if (options?.pole && typeof options.pole_reference === "string")
          out.push({ component_id: options.pole_reference, qty_per_product: 1, label: "pole" });
        return out;
      }
      return lines
        .filter((l: any) => l.mandatory || !l.depends_on_option || options?.[l.depends_on_option])
        .map((l: any) => ({ component_id: l.component_item_id, qty_per_product: Number(l.qty_per_product) || 1 }));
    },
  };
}

/** Candidate products for the fill engine (family / pole / fragile flags). */
export async function getFillCandidates(sb: SB): Promise<
  Array<{ product_id: string; reference: string | null; family: string | null; fragile: boolean; is_pole: boolean }>
> {
  const { data } = await sb
    .from("packing_item")
    .select("id, reference, family, is_lamp_pole, v:packing_item_version!packing_item_current_version_fk(fragile, inner_l_mm, inner_w_mm, inner_h_mm)")
    .eq("active", true);
  return ((data ?? []) as any[])
    .map((r) => {
      const v = Array.isArray(r.v) ? r.v[0] : r.v;
      return {
        product_id: r.id,
        reference: r.reference,
        family: r.family,
        fragile: !!v?.fragile,
        is_pole: !!r.is_lamp_pole,
        // only offer products that actually have dimensions (else CBM is unknown)
        _hasDims: v?.inner_l_mm != null && v?.inner_w_mm != null && v?.inner_h_mm != null,
      };
    })
    .filter((c) => (c as any)._hasDims)
    .map(({ _hasDims, ...c }: any) => c);
}

// ---------------------------------------------------------------------
// Library / issues / import summary reads (for pages)
// ---------------------------------------------------------------------
export async function getLatestImport(sb: SB) {
  const { data } = await sb
    .from("packing_import")
    .select("id, file_name, imported_at, import_version, row_count, report")
    .order("imported_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

export interface LibraryFilters {
  q?: string;
  family?: string;
  packaging_type?: string;
  flag?: "missing_dims" | "unverified" | "poles" | "no_image";
  status?: string;
}

export async function listLibraryItems(sb: SB, f: LibraryFilters) {
  let query = sb
    .from("packing_item")
    .select(
      "id, reference, name, family, component_type, is_lamp_pole, is_oversized, verification_status, image_id, " +
        "img:packing_product_image!packing_item_image_id_fkey(storage_path), " +
        "v:packing_item_version!packing_item_current_version_fk(status, packaging_type, qty_per_outside_carton, inner_l_mm, inner_w_mm, inner_h_mm, outer_l_mm, outer_w_mm, outer_h_mm, net_weight_kg, gross_weight_unit_kg, cbm_inner, cbm_outer, lamp_pole, oversized)"
    )
    .order("reference")
    .limit(500);

  if (f.q) query = query.or(`reference.ilike.%${f.q}%,name.ilike.%${f.q}%`);
  if (f.family) query = query.eq("family", f.family);
  if (f.flag === "unverified") query = query.eq("verification_status", "unverified");
  if (f.flag === "poles") query = query.eq("is_lamp_pole", true);
  if (f.flag === "no_image") query = query.is("image_id", null);

  const { data } = await query;
  let rows = (data ?? []).map((r: any) => ({
    ...r,
    v: Array.isArray(r.v) ? r.v[0] : r.v,
    img: Array.isArray(r.img) ? r.img[0] : r.img,
  }));

  // client-side flags that need the version data
  if (f.packaging_type) rows = rows.filter((r) => r.v?.packaging_type === f.packaging_type);
  if (f.status) rows = rows.filter((r) => r.v?.status === f.status);
  if (f.flag === "missing_dims")
    rows = rows.filter((r) => !r.v || r.v.inner_l_mm == null || r.v.inner_w_mm == null || r.v.inner_h_mm == null);
  return rows;
}

export async function listFamilies(sb: SB): Promise<string[]> {
  const { data } = await sb.from("packing_item").select("family").not("family", "is", null);
  return Array.from(new Set((data ?? []).map((r: any) => r.family))).sort();
}

export async function listIssues(sb: SB, opts: { type?: string; status?: string } = {}) {
  let q = sb
    .from("packing_import_issue")
    .select("id, source_row, column_ref, issue_type, severity, original_value, detected_message, proposed_interpretation, status, item_id")
    .order("source_row", { ascending: true, nullsFirst: false })
    .limit(1000);
  if (opts.type) q = q.eq("issue_type", opts.type);
  if (opts.status) q = q.eq("status", opts.status);
  const { data } = await q;
  return data ?? [];
}

export async function issueTypeCounts(sb: SB) {
  const { data } = await sb.from("packing_import_issue").select("issue_type, severity");
  const counts: Record<string, number> = {};
  for (const r of data ?? []) counts[(r as any).issue_type] = (counts[(r as any).issue_type] ?? 0) + 1;
  return counts;
}
