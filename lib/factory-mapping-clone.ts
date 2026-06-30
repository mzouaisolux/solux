/**
 * "Copy factory mappings from an existing family" — pure matching/cloning logic.
 *
 * PURE module — no DB / no server imports → unit-testable + safe to import from
 * both server actions (the standalone copy + the duplicateCategory checkbox).
 *
 * THE PROBLEM IT SOLVES
 * --------------------
 * factory_mappings are keyed 1:1 to a config_field_option via a UNIQUE
 * constraint on `option_id`. Duplicating a family (admin/categories
 * duplicateCategory) creates BRAND-NEW option rows with new ids, so the source
 * family's mappings — bound to the OLD option ids — don't carry over. The new
 * family then resolves every config value to "missing" and the D1.1 release
 * gate (lib/task-list-mapping-status.ts) blocks production until ~20-40 mappings
 * are recreated by hand.
 *
 * THE MATCH KEY
 * -------------
 * We re-bind a source mapping to a target option by matching on
 * `${field_name}|${option_value.toLowerCase()}` (field name verbatim, value
 * lower-cased). This is deliberately NOT category-scoped: the planner is given
 * exactly ONE source family's options and ONE target family's options, so the
 * category is constant on each side and the field+value pair is unambiguous
 * within the pair. (The task-list RESOLVER, by contrast, spans ALL categories
 * at once, so it scopes its key by category_id via optionLookupKey — see
 * lib/types.ts. Don't "align" this key with the resolver's: different scope.)
 * The clone writes mappings onto target option_ids, and the resolver later
 * finds them by deriving that same target option_id from its category-scoped
 * key — so the two stay 1:1 without sharing a key format.
 *
 * The caller writes the resulting rows through the existing
 * onConflict:"option_id" upsert, so re-running is idempotent.
 */

/**
 * Normalized match key for a (field, option) pair WITHIN a single source/target
 * family pair (category is constant on each side, so it's intentionally not in
 * the key — unlike the cross-category resolver key, optionLookupKey).
 */
export function factoryOptionKey(fieldName: string, optionValue: string): string {
  return `${fieldName}|${String(optionValue).toLowerCase()}`;
}

/** A SOURCE dropdown option that already carries a factory mapping to clone. */
export type SourceMappedOption = {
  field_name: string;
  option_value: string;
  factory_instruction: string;
  factory_code: string | null;
  notes: string | null;
  active: boolean;
};

/** A TARGET dropdown option that may receive a cloned mapping. */
export type TargetOption = {
  /** Target field id — written onto the new mapping row. */
  field_id: string;
  /** Target option id — the upsert conflict key. */
  option_id: string;
  field_name: string;
  option_value: string;
};

/**
 * One row to upsert into factory_mappings. Mirrors the shape written by
 * upsertFactoryMapping in app/(app)/factory-mapping/actions.ts (conflict key =
 * option_id). `updated_at` is stamped by the server action, not here (pure).
 */
export type ClonedMappingRow = {
  field_id: string;
  option_id: string;
  factory_instruction: string;
  factory_code: string | null;
  notes: string | null;
  active: boolean;
};

export type ClonePlan = {
  /** Rows to upsert onto the target options (one per matched target option). */
  rows: ClonedMappingRow[];
  /** Target options that matched a source mapping (= rows.length). */
  copied: number;
  /** Target options with NO matching source mapping — left untouched. */
  skipped: number;
  /** How many source mappings were available to clone (context for the UI). */
  sourceMappings: number;
};

/**
 * Build the set of factory-mapping rows to write onto a target family by
 * matching each TARGET dropdown option against the SOURCE family's mappings.
 *
 * Iteration is target-driven so that:
 *   - a target option with no source mapping is reported as `skipped`
 *     (exactly the options that will still read "missing" after the copy), and
 *   - two target options sharing a value both receive the source mapping
 *     (a value→option lookup would only hit one).
 *
 * The source side is indexed by the normalized key; on the rare collision of
 * two source options sharing a key, the last one wins (deterministic, matches
 * Map.set semantics).
 */
export function buildFactoryMappingClonePlan(args: {
  sourceMappedOptions: SourceMappedOption[];
  targetOptions: TargetOption[];
}): ClonePlan {
  const { sourceMappedOptions, targetOptions } = args;

  const sourceByKey = new Map<string, SourceMappedOption>();
  for (const s of sourceMappedOptions) {
    sourceByKey.set(factoryOptionKey(s.field_name, s.option_value), s);
  }

  const rows: ClonedMappingRow[] = [];
  let skipped = 0;
  for (const t of targetOptions) {
    const src = sourceByKey.get(factoryOptionKey(t.field_name, t.option_value));
    if (!src) {
      skipped++;
      continue;
    }
    rows.push({
      field_id: t.field_id,
      option_id: t.option_id,
      factory_instruction: src.factory_instruction,
      factory_code: src.factory_code,
      notes: src.notes,
      active: src.active,
    });
  }

  return {
    rows,
    copied: rows.length,
    skipped,
    sourceMappings: sourceMappedOptions.length,
  };
}
