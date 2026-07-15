// =====================================================================
// lib/packing-core/fill.ts — "which products could still be added?"
//
// A RULE_BASED (dimension-aware) estimate — NOT a physical placement. It uses
// INTEGER carton quantities via the packaging BOM (master cartons, incomplete
// cartons, heads/arms/anchors/poles), CBM, weight, door + longest-dimension
// guards. It NEVER computes `remaining CBM ÷ unit CBM`.
//
// Wording rule (§7): results say "could potentially be added" /
// "estimated additional quantity" — never "will fit".
// =====================================================================
import type {
  PackingContext,
  ContainerType,
  CalcMethod,
  Confidence,
} from "./types.ts";
import { calcComponent } from "./carton.ts";
import { r, longestAxis, fitsThroughDoor } from "./cbm.ts";
import { usableCbm } from "./container.ts";

export type FillObjective =
  | "max_cbm_utilization"
  | "max_products"
  | "min_remaining_cbm"
  | "maximize_selected_product"
  | "balanced_mix"
  | "only_present";

export interface FillConstraints {
  families?: string[];              // restrict to these families
  selected_product_ids?: string[];  // restrict to these ids
  only_present?: boolean;           // only products already in the request
  min_qty?: number;
  qty_increment?: number;
  max_qty?: number;
  min_final_utilization_pct?: number; // discard options below this
  min_safety_reserve_cbm?: number;    // keep this CBM free (on top of container reserve)
  exclude_fragile?: boolean;
  exclude_poles?: boolean;
  selected_product_id?: string;       // for maximize_selected_product
}

export interface FillCandidate {
  product_id: string;
  reference: string | null;
  family?: string | null;
  fragile?: boolean;
  is_pole?: boolean;
  in_current_request?: boolean;
  compatible_containers?: string[] | null;
}

export interface FillLine {
  product_id: string;
  reference: string | null;
  quantity: number;
  added_cbm: number;
  added_gross: number;
  packages_summary: string;
}

export interface FillOption {
  label: string;
  objective: FillObjective;
  method: CalcMethod;      // RULE_BASED when door dims known, else VOLUME_AND_WEIGHT
  confidence: Confidence;
  lines: FillLine[];
  additional_cbm: number;
  additional_gross: number;
  final_cbm: number;
  usable_cbm: number;
  final_utilization_pct: number;
  remaining_cbm: number;
  final_gross: number;
  remaining_payload_kg: number | null;
  caution: string;
  notes: string[];
}

export interface FillInput {
  context: PackingContext;
  container: ContainerType;
  containerCount?: number;      // default 1
  currentCbm: number;
  currentGross: number;
  candidates: FillCandidate[];
  objective: FillObjective;
  constraints?: FillConstraints;
  maxOptions?: number;          // default 5
}

export interface FillResult {
  objective: FillObjective;
  method: CalcMethod;
  container_code: string;
  usable_cbm: number;
  remaining_cbm: number;
  remaining_payload_kg: number | null;
  options: FillOption[];
  warnings: string[];
  requires_operations_validation: true;
}

// ---------------------------------------------------------------------
// Footprint of adding `qty` of a product — reuses the integer carton + BOM
// logic from carton.ts (heads/arms/anchors/poles all included via resolveBom).
// ---------------------------------------------------------------------
interface Footprint {
  cbm: number;
  gross: number;
  longest_mm: number;
  has_pole: boolean;
  fitsDoor: (c: ContainerType) => boolean;
  summary: string;
}

function footprint(ctx: PackingContext, productId: string, qty: number): Footprint | null {
  if (qty <= 0) return { cbm: 0, gross: 0, longest_mm: 0, has_pole: false, fitsDoor: () => true, summary: "" };
  const bom = ctx.resolveBom
    ? ctx.resolveBom(productId, {})
    : [{ component_id: productId, qty_per_product: 1 }];
  let cbm = 0, gross = 0, longest = 0, hasPole = false;
  const dimsList: { l_mm: number | null; w_mm: number | null; h_mm: number | null }[] = [];
  const kinds: Record<string, number> = {};
  let any = false;
  for (const line of bom) {
    const spec = ctx.getPackaging(line.component_id);
    if (!spec) continue;
    any = true;
    const { packages } = calcComponent({
      lineIndex: 0,
      productId,
      quantity: qty * line.qty_per_product,
      spec: { ...spec, volumetric_factor: spec.volumetric_factor ?? ctx.config.volumetric_factor },
      config: ctx.config,
    });
    for (const p of packages) {
      cbm += p.cbm_total ?? 0;
      gross += p.gross_weight ?? 0;
      if (p.is_pole) hasPole = true;
      const la = longestAxis(p.dimensions_mm);
      if (la != null) longest = Math.max(longest, la);
      dimsList.push(p.dimensions_mm);
      kinds[p.package_kind] = (kinds[p.package_kind] ?? 0) + p.count;
    }
  }
  if (!any) return null; // unknown product — cannot add
  const summary = Object.entries(kinds).map(([k, n]) => `${n} ${k.replace(/_/g, " ")}`).join(", ");
  return {
    cbm: r(cbm, 6),
    gross: r(gross, 3),
    longest_mm: longest,
    has_pole: hasPole,
    fitsDoor: (c) => dimsList.every((d) => fitsThroughDoor(d, c.door_w_mm, c.door_h_mm)),
    summary,
  };
}

// ---------------------------------------------------------------------
// Largest integer qty of a product that still fits the remaining space.
// ---------------------------------------------------------------------
function maxAddable(
  ctx: PackingContext,
  container: ContainerType,
  productId: string,
  remainingCbm: number,
  remainingPayload: number | null,
  cons: FillConstraints
): { qty: number; fp: Footprint } | null {
  const inc = Math.max(1, Math.floor(cons.qty_increment ?? 1));
  const minQ = Math.max(inc, cons.qty_increment ? inc : (cons.min_qty ?? 1));
  const maxQ = cons.max_qty && cons.max_qty > 0 ? cons.max_qty : 100_000;

  // Dimension guards on a single unit — if one unit can't pass the door or
  // exceeds the container length, this product cannot be added at all.
  const unit = footprint(ctx, productId, minQ);
  if (!unit || unit.cbm <= 0) return null;
  if (!unit.fitsDoor(container)) return null;
  if (container.internal.l_mm != null && unit.longest_mm > container.internal.l_mm) return null;

  // Estimate density from a sample to bound the search.
  const sampleQ = Math.max(minQ, inc * 24);
  const sample = footprint(ctx, productId, sampleQ);
  const density = sample && sample.cbm > 0 ? sample.cbm / sampleQ : unit.cbm / minQ;
  let hi = Math.max(minQ, Math.min(maxQ, Math.ceil((remainingCbm / density) + inc)));
  hi = hi - (hi % inc); if (hi < minQ) hi = minQ;

  const feasible = (q: number): { ok: boolean; fp: Footprint } | null => {
    const fp = footprint(ctx, productId, q);
    if (!fp) return null;
    const cbmOk = fp.cbm <= remainingCbm + 1e-9;
    const wtOk = remainingPayload == null || fp.gross <= remainingPayload + 1e-6;
    return { ok: cbmOk && wtOk, fp };
  };

  // Ensure minQ is feasible.
  const minCheck = feasible(minQ);
  if (!minCheck || !minCheck.ok) return null;

  // Grow hi until infeasible (bounded), then binary-search the boundary.
  let guard = 0;
  while (guard++ < 40) {
    const c = feasible(hi);
    if (!c) return null;
    if (!c.ok) break;
    if (hi >= maxQ) return { qty: hi, fp: c.fp };
    hi = Math.min(maxQ, hi * 2);
    hi = hi - (hi % inc);
  }
  let lo = minQ, best = minQ, bestFp = minCheck.fp;
  while (lo <= hi) {
    let mid = Math.floor((lo + hi) / 2);
    mid = mid - (mid % inc); if (mid < minQ) mid = minQ;
    const c = feasible(mid);
    if (c && c.ok) { best = mid; bestFp = c.fp; lo = mid + inc; }
    else hi = mid - inc;
    if (guard++ > 200) break;
  }
  return { qty: best, fp: bestFp };
}

// ---------------------------------------------------------------------
// Candidate filtering by constraints.
// ---------------------------------------------------------------------
function eligible(candidates: FillCandidate[], container: ContainerType, cons: FillConstraints): FillCandidate[] {
  return candidates.filter((c) => {
    if (cons.exclude_poles && c.is_pole) return false;
    if (cons.exclude_fragile && c.fragile) return false;
    if (cons.only_present && !c.in_current_request) return false;
    if (cons.selected_product_ids?.length && !cons.selected_product_ids.includes(c.product_id)) return false;
    if (cons.families?.length && !(c.family && cons.families.includes(c.family))) return false;
    if (c.compatible_containers?.length && !c.compatible_containers.includes(container.code)) return false;
    return true;
  });
}

// ---------------------------------------------------------------------
// Public entry.
// ---------------------------------------------------------------------
export function computeFill(input: FillInput): FillResult {
  const { context, container, currentCbm, currentGross } = input;
  const count = input.containerCount ?? 1;
  const cons = input.constraints ?? {};
  const maxOptions = input.maxOptions ?? 5;
  const warnings: string[] = [];

  const usableTotal = (usableCbm(container) ?? 0) * count;
  const reserve = cons.min_safety_reserve_cbm ?? 0;
  const remainingCbm = r(Math.max(usableTotal - reserve - currentCbm, 0), 3);
  const payloadTotal = container.max_payload_kg != null ? container.max_payload_kg * count : null;
  const remainingPayload = payloadTotal != null ? r(payloadTotal - currentGross, 1) : null;

  // Method: dimension-aware (door dims known) → RULE_BASED, else VOLUME_AND_WEIGHT.
  const method: CalcMethod = container.door_w_mm != null && container.door_h_mm != null
    ? "RULE_BASED" : "VOLUME_AND_WEIGHT";

  const cands = eligible(input.candidates, container, cons);
  if (usableCbm(container) == null) warnings.push(`${container.code}: operational usable CBM not configured — cannot estimate additions.`);
  if (!cands.length) warnings.push("No candidate products match the selected catalogue/constraints.");

  const finalize = (label: string, objective: FillObjective, lines: FillLine[]): FillOption | null => {
    const addCbm = r(lines.reduce((s, l) => s + l.added_cbm, 0), 3);
    const addGross = r(lines.reduce((s, l) => s + l.added_gross, 0), 1);
    if (lines.length === 0 || addCbm <= 0) return null;
    const finalCbm = r(currentCbm + addCbm, 3);
    const util = usableTotal > 0 ? r((finalCbm / usableTotal) * 100, 1) : 0;
    if (cons.min_final_utilization_pct && util < cons.min_final_utilization_pct) return null;
    return {
      label, objective, method,
      confidence: method === "RULE_BASED" ? "medium" : "low",
      lines,
      additional_cbm: addCbm,
      additional_gross: addGross,
      final_cbm: finalCbm,
      usable_cbm: r(usableTotal, 3),
      final_utilization_pct: util,
      remaining_cbm: r(Math.max(usableTotal - finalCbm, 0), 3),
      final_gross: r(currentGross + addGross, 1),
      remaining_payload_kg: payloadTotal != null ? r(payloadTotal - currentGross - addGross, 1) : null,
      caution: "Estimated additional quantity — could potentially be added, subject to physical loading validation. Physical placement NOT verified.",
      notes: [],
    };
  };

  const mkLine = (c: FillCandidate, qty: number, fp: Footprint): FillLine => ({
    product_id: c.product_id, reference: c.reference, quantity: qty,
    added_cbm: fp.cbm, added_gross: fp.gross, packages_summary: fp.summary,
  });

  const options: FillOption[] = [];

  // ---- Single-product completion options ----
  const singles: { c: FillCandidate; qty: number; fp: Footprint }[] = [];
  for (const c of cands) {
    const m = maxAddable(context, container, c.product_id, remainingCbm, remainingPayload, cons);
    if (m && m.qty > 0) singles.push({ c, qty: m.qty, fp: m.fp });
  }
  // Rank singles by objective.
  singles.sort((a, b) =>
    input.objective === "max_products" ? b.qty - a.qty : b.fp.cbm - a.fp.cbm
  );
  for (const s of singles.slice(0, 3)) {
    const opt = finalize(`Add up to ${s.qty} × ${s.c.reference ?? s.c.product_id}`, input.objective, [mkLine(s.c, s.qty, s.fp)]);
    if (opt) options.push(opt);
  }

  // ---- Mixed-product combos via greedy strategies over shrinking space ----
  const greedy = (ordered: FillCandidate[], label: string, objective: FillObjective, perCandidateCap?: (n: number) => number): FillOption | null => {
    let remCbm = remainingCbm;
    let remPay = remainingPayload;
    const lines: FillLine[] = [];
    let idx = 0;
    for (const c of ordered) {
      if (remCbm <= 0.001) break;
      const capCons = { ...cons };
      if (perCandidateCap) capCons.max_qty = Math.max(capCons.qty_increment ?? 1, perCandidateCap(ordered.length));
      const m = maxAddable(context, container, c.product_id, remCbm, remPay, capCons);
      if (m && m.qty > 0) {
        lines.push(mkLine(c, m.qty, m.fp));
        remCbm = r(remCbm - m.fp.cbm, 6);
        if (remPay != null) remPay = r(remPay - m.fp.gross, 3);
      }
      if (++idx > 12) break; // bound
    }
    return finalize(label, objective, lines);
  };

  const density = (c: FillCandidate): number => {
    const fp = footprint(context, c.product_id, Math.max(1, cons.qty_increment ?? 1) * 24);
    return fp && fp.cbm > 0 ? fp.cbm : Number.POSITIVE_INFINITY;
  };

  // A) Maximum space utilization — fill densest-first, then top up.
  const byDenseDesc = [...cands].sort((a, b) => density(b) - density(a));
  const A = greedy(byDenseDesc, "Maximum space utilization", "max_cbm_utilization");
  if (A) options.push(A);

  // B) Balanced mix — cap each candidate near an equal CBM share, then top up.
  if (cands.length >= 2) {
    const share = remainingCbm / cands.length;
    let remCbm = remainingCbm, remPay = remainingPayload;
    const lines: FillLine[] = [];
    for (const c of cands) {
      const cap = Math.min(remCbm, share);
      const m = maxAddable(context, container, c.product_id, cap, remPay, cons);
      if (m && m.qty > 0) { lines.push(mkLine(c, m.qty, m.fp)); remCbm = r(remCbm - m.fp.cbm, 6); if (remPay != null) remPay = r(remPay - m.fp.gross, 3); }
    }
    const balanced = finalize("Balanced product mix", "balanced_mix", lines);
    if (balanced) options.push(balanced);
  }

  // C) Maximum quantity — smallest-CBM (least dense) first to add most units.
  const byDenseAsc = [...cands].sort((a, b) => density(a) - density(b));
  const C = greedy(byDenseAsc, "Maximum quantity (most units)", "max_products");
  if (C) options.push(C);

  // D) Maximize a selected product then fill.
  if (cons.selected_product_id) {
    const sel = cands.find((c) => c.product_id === cons.selected_product_id);
    if (sel) {
      const ordered = [sel, ...byDenseDesc.filter((c) => c.product_id !== sel.product_id)];
      const D = greedy(ordered, `Maximize ${sel.reference ?? "selected"} then fill`, "maximize_selected_product");
      if (D) options.push(D);
    }
  }

  // Dedupe by (rounded final cbm + line signature) and keep the best few.
  const seen = new Set<string>();
  const distinct = options.filter((o) => {
    const sig = `${o.final_utilization_pct}|${o.lines.map((l) => `${l.product_id}:${l.quantity}`).sort().join(",")}`;
    if (seen.has(sig)) return false; seen.add(sig); return true;
  });
  distinct.sort((a, b) => b.final_utilization_pct - a.final_utilization_pct);

  return {
    objective: input.objective,
    method,
    container_code: container.code,
    usable_cbm: r(usableTotal, 3),
    remaining_cbm: remainingCbm,
    remaining_payload_kg: remainingPayload,
    options: distinct.slice(0, maxOptions),
    warnings,
    requires_operations_validation: true,
  };
}
