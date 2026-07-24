/**
 * Product Knowledge Hub — diff helpers (pure; no server imports).
 *
 * A change request carries a `diff`: the list of spec values that changed
 * between the currently-published state and a proposed state. The diff's blast
 * radius depends on scope:
 *   - a COMMON field change → every product in the family is affected;
 *   - a MODEL field change → only that one product is affected.
 */

import type { FamilyDatasheet, SpecDiffEntry } from "./types";

type ProposedValue = {
  value_number: number | null;
  value_text: string | null;
};

/** Proposed edits keyed the same way values are scoped. */
export type ProposedChanges = {
  /** Common field edits: fieldId → proposed value. */
  common: Record<string, ProposedValue>;
  /** Model field edits: productId → fieldId → proposed value. */
  model: Record<string, Record<string, ProposedValue>>;
};

function sameValue(
  a: { value_number: number | null; value_text: string | null } | null,
  b: ProposedValue
): boolean {
  const an = a?.value_number ?? null;
  const at = (a?.value_text ?? null) || null;
  const bn = b.value_number ?? null;
  const bt = (b.value_text ?? null) || null;
  return an === bn && at === bt;
}

/**
 * Compute the diff between the CURRENT family datasheet and a set of proposed
 * edits. Only genuinely-changed values produce a diff entry.
 */
export function computeDiff(
  current: FamilyDatasheet,
  proposed: ProposedChanges
): SpecDiffEntry[] {
  const out: SpecDiffEntry[] = [];
  const fieldById = new Map(current.fields.map((f) => [f.id, f]));

  // Common field changes.
  for (const [fieldId, to] of Object.entries(proposed.common ?? {})) {
    const field = fieldById.get(fieldId);
    if (!field) continue;
    const resolved = current.commonSpecs.find((s) => s.field.id === fieldId);
    const from = resolved?.value
      ? { value_number: resolved.value.value_number, value_text: resolved.value.value_text }
      : null;
    if (sameValue(from, to)) continue;
    out.push({
      field_id: fieldId,
      key: field.key,
      label: field.label,
      scope: "common",
      product_id: null,
      value_kind: field.value_kind,
      unit: field.unit,
      from,
      to,
    });
  }

  // Model field changes.
  for (const [productId, fieldMap] of Object.entries(proposed.model ?? {})) {
    const model = current.models.find((m) => m.id === productId);
    for (const [fieldId, to] of Object.entries(fieldMap ?? {})) {
      const field = fieldById.get(fieldId);
      if (!field) continue;
      const resolved = model?.modelSpecs.find((s) => s.field.id === fieldId);
      const from = resolved?.value
        ? { value_number: resolved.value.value_number, value_text: resolved.value.value_text }
        : null;
      if (sameValue(from, to)) continue;
      out.push({
        field_id: fieldId,
        key: field.key,
        label: field.label,
        scope: "model",
        product_id: productId,
        value_kind: field.value_kind,
        unit: field.unit,
        from,
        to,
      });
    }
  }

  return out;
}

/**
 * The set of product ids affected by a diff, given the family's full product
 * list. A common-field change hits ALL products; a model-field change hits
 * only its product.
 */
export function modelsFromDiff(allProductIds: string[], diff: SpecDiffEntry[]): string[] {
  const affected = new Set<string>();
  let touchedCommon = false;
  for (const entry of diff) {
    if (entry.scope === "common") {
      touchedCommon = true;
    } else if (entry.product_id) {
      affected.add(entry.product_id);
    }
  }
  if (touchedCommon) for (const id of allProductIds) affected.add(id);
  return [...affected];
}
