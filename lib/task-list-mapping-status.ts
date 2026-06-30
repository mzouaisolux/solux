/**
 * Task-list factory-mapping completeness + release gating (D1.1).
 *
 * PURE module — no DB / no server imports → unit-testable + safe to import
 * from the page (which already has the resolved context) AND from the server
 * helper (lib/task-list-mapping-server.ts) which fetches the context.
 *
 * IMPORTANT — Factory Mapping stays AUTONOMOUS. This module never creates or
 * stores per-task mappings; it only READS the existing global/client/order
 * mapping layers via the SAME pure resolver the task-list page uses
 * (`resolveFactoryInstruction`). One source of truth for "what counts as a
 * missing mapping" — no logic divergence between the page and the server guard.
 */

import {
  CUSTOM_OPTION_SENTINEL,
  customValueKey,
  resolveFactoryInstruction,
  type ConfigField,
  type FactoryMapping,
} from "./types.ts";

export type MappingLine = {
  productId: string;
  categoryId: string | null;
  config: Record<string, string>;
  /** Per-order factory overrides for this line. */
  overrides: Record<string, string>;
};

/**
 * Count the factory mappings still unresolved across a task list's lines.
 * Mirrors TaskLineEditor's `factoryRows`: for every sales DROPDOWN field that
 * has a value, resolve override → client preset → global mapping → missing,
 * and count the ones that land on "missing".
 */
export function countMissingMappings(args: {
  lines: MappingLine[];
  /** category_id → sales-side ConfigField[] (sales + "both" scope). */
  salesFieldsByCategory: Map<string, ConfigField[]>;
  mappingsByOption: Map<string, FactoryMapping>;
  optionIdByFieldValue: Map<string, string>;
  /** product_id → { fieldName → client preset instruction }. */
  clientOverridesByProduct: Map<string, Record<string, string>>;
}): number {
  let missing = 0;
  for (const line of args.lines) {
    if (!line.categoryId) continue;
    const clientOverrides =
      args.clientOverridesByProduct.get(line.productId) ?? null;
    const fields = (args.salesFieldsByCategory.get(line.categoryId) ?? []).filter(
      (f) => f.field_type === "dropdown"
    );
    for (const f of fields) {
      const raw = line.config[f.field_name];
      const display =
        raw === CUSTOM_OPTION_SENTINEL
          ? line.config[customValueKey(f.field_name)] ?? ""
          : raw ?? "";
      if (!display) continue; // no value set → nothing to map
      const r = resolveFactoryInstruction({
        categoryId: line.categoryId,
        fieldName: f.field_name,
        salesValue: display,
        overrides: line.overrides,
        clientOverrides,
        mappingsByOption: args.mappingsByOption,
        optionIdByFieldValue: args.optionIdByFieldValue,
      });
      if (r.source === "missing") missing++;
    }
  }
  return missing;
}

/**
 * Count required-for-production fields that have NO value yet across a task
 * list's lines. Complements countMissingMappings: that one skips empty fields
 * ("no value → nothing to map"), so a REQUIRED field left blank is invisible to
 * it. This surfaces those gaps (BUG-6 class: "SOLAR PANEL *, OPTIC *, CCT *"
 * blank after launch) at the top of the page, not only at the release gate.
 * Uses `required_for_production` only (the explicit production gate) → no false
 * alarms from quotation-only "required" fields.
 */
export function countRequiredEmpty(args: {
  lines: MappingLine[];
  /** category_id → sales-side ConfigField[] (same map countMissingMappings uses). */
  salesFieldsByCategory: Map<string, ConfigField[]>;
}): number {
  let empty = 0;
  for (const line of args.lines) {
    if (!line.categoryId) continue;
    const fields = (args.salesFieldsByCategory.get(line.categoryId) ?? []).filter(
      (f) => f.required_for_production === true
    );
    for (const f of fields) {
      const raw = line.config[f.field_name];
      const display =
        raw === CUSTOM_OPTION_SENTINEL
          ? line.config[customValueKey(f.field_name)] ?? ""
          : raw ?? "";
      if (!display.trim()) empty++;
    }
  }
  return empty;
}

/**
 * Release-to-production decision (pure → testable). Order matters: status,
 * then open revision, then mapping completeness — so the surfaced reason is
 * the most blocking one.
 */
export function evaluateRelease(args: {
  /** Is the current status one the caller allows to release from? */
  statusAllowed: boolean;
  missingCount: number;
  hasOpenRevision: boolean;
  /** Number of product lines on the task list. Undefined = not checked. */
  lineCount?: number;
}): { ok: boolean; reason: string | null } {
  if (!args.statusAllowed) {
    return {
      ok: false,
      reason:
        "This task list isn't in a state that can be released to production.",
    };
  }
  // An empty task list has nothing to manufacture — releasing it would create a
  // production order for zero products. Block it with a clear, actionable reason.
  if (args.lineCount === 0) {
    return {
      ok: false,
      reason:
        "This task list has no products — there's nothing to manufacture. Check the source quotation has line items before releasing to production.",
    };
  }
  if (args.hasOpenRevision) {
    return {
      ok: false,
      reason:
        "There's an open revision request — Sales must reply and re-submit before this task list can be released to production.",
    };
  }
  if (args.missingCount > 0) {
    return {
      ok: false,
      reason: `Factory Mapping is incomplete — ${args.missingCount} required factory mapping${
        args.missingCount === 1 ? "" : "s"
      } still to complete before releasing to production.`,
    };
  }
  return { ok: true, reason: null };
}
