/**
 * Sales & Analytics — pure audit-diff (module spec §5).
 *
 * Every create/update/delete on a sales entity must land in `sales_audit_log`
 * with (field, old_value, new_value, user, when). This module computes those
 * rows from a before/after snapshot; the server action just inserts what it
 * returns. Pure, so the exact diff semantics are unit-tested without a DB.
 */

export type SalesEntityType =
  | "sales_order"
  | "sales_client"
  | "sales_client_alias"
  | "monthly_sales_history"
  | "saler";

export type AuditAction = "create" | "update" | "delete" | "merge";

export type AuditEntry = {
  entity_type: SalesEntityType;
  entity_id: string;
  action: AuditAction;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  user_id: string | null;
};

/** Empty string, null and undefined are all "no value" and compare equal, so a
 *  blank cell edited to another blank never produces a phantom diff. Numbers are
 *  stringified so 100 (number) and "100" (string) are equal. */
function norm(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/** One audit row per CHANGED field (update). Unchanged fields are skipped. */
export function diffFields(
  entityType: SalesEntityType,
  entityId: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields: readonly string[],
  userId: string | null,
): AuditEntry[] {
  const out: AuditEntry[] = [];
  for (const f of fields) {
    const o = norm(before[f]);
    const n = norm(after[f]);
    if (o === n) continue;
    out.push({
      entity_type: entityType,
      entity_id: entityId,
      action: "update",
      field: f,
      old_value: o,
      new_value: n,
      user_id: userId,
    });
  }
  return out;
}

/** A create/delete/merge marker row (no per-field diff). */
export function markerEntry(
  entityType: SalesEntityType,
  entityId: string,
  action: Exclude<AuditAction, "update">,
  userId: string | null,
  detail?: { field?: string; old_value?: string | null; new_value?: string | null },
): AuditEntry {
  return {
    entity_type: entityType,
    entity_id: entityId,
    action,
    field: detail?.field ?? null,
    old_value: detail?.old_value ?? null,
    new_value: detail?.new_value ?? null,
    user_id: userId,
  };
}
