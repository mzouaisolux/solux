"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { getCurrentUserRole } from "@/lib/auth";
import {
  requireCapability,
  clearCapabilityCache,
  ALL_CAPABILITY_KEYS,
} from "@/lib/permissions";
import { emitEvent } from "@/lib/events";
import { VIEW_AS_ROLES } from "@/lib/types";

/**
 * Save the full permissions matrix.
 *
 * The form sends checkboxes named `cap[<role>:<permission_key>]` —
 * unchecked checkboxes are simply absent from the form data per HTML
 * spec. So we walk the full catalog × roles cartesian product and set
 * `enabled = true` iff the form contains the corresponding name.
 *
 * This means a single save persists the entire matrix state, not just
 * a diff. Simpler reasoning, no "what if the client missed an update"
 * edge cases.
 *
 * Steps:
 *   1. Capability gate (admin.manage_permissions — super-admin only by default).
 *   2. Parse the form → desired (role, key, enabled) tuples.
 *   3. Compute a diff vs the current DB state for audit log purposes.
 *   4. Bulk upsert into role_permissions.
 *   5. clearCapabilityCache() so the change is immediate in this process.
 *   6. Emit HIGH-severity event with the diff payload.
 *   7. revalidatePath.
 */
export async function updatePermissionsMatrix(formData: FormData) {
  await requireCapability("admin.manage_permissions");

  const supabase = createClient();
  const { userId } = await getCurrentUserRole();

  // 1. The full capability catalog (CODE = single source of truth) → every
  //    (role, key) pair to persist. No dependency on a DB `permissions` catalog
  //    table, so a newly-added capability is toggleable here immediately, with
  //    no migration.
  const allKeys = ALL_CAPABILITY_KEYS;

  // 2. Load current matrix state for diff computation.
  const { data: currentRows, error: currentErr } = await supabase
    .from("role_permissions")
    .select("role, permission_key, enabled");
  if (currentErr) throw new Error(`Could not load current matrix: ${currentErr.message}`);
  const currentMap = new Map<string, boolean>();
  for (const r of currentRows ?? []) {
    currentMap.set(`${r.role}:${r.permission_key}`, !!r.enabled);
  }

  // 3. Parse the form: collect checked checkboxes.
  const desiredEnabled = new Set<string>();
  for (const [name, value] of formData.entries()) {
    // Field name pattern: cap[<role>:<key>]
    const match = name.match(/^cap\[(.+?):(.+?)\]$/);
    if (!match) continue;
    if (value === "on" || value === "true") {
      desiredEnabled.add(`${match[1]}:${match[2]}`);
    }
  }

  // PERM-2 — never let a save disable the super-admin's own gate to THIS page.
  // One accidental uncheck would lock everyone out with no in-app recovery, so
  // force the cell on regardless of the submitted checkbox state.
  desiredEnabled.add("super_admin:admin.manage_permissions");

  // 4. Build the desired full matrix (4 roles × N keys).
  const now = new Date().toISOString();
  const upsertRows: Array<{
    role: string;
    permission_key: string;
    enabled: boolean;
    updated_at: string;
    updated_by: string | null;
  }> = [];
  const changedCells: Array<{ role: string; key: string; from: boolean; to: boolean }> =
    [];

  for (const role of VIEW_AS_ROLES) {
    for (const key of allKeys) {
      const cellKey = `${role}:${key}`;
      const desired = desiredEnabled.has(cellKey);
      const current = currentMap.get(cellKey) ?? false;
      upsertRows.push({
        role,
        permission_key: key,
        enabled: desired,
        updated_at: now,
        updated_by: userId,
      });
      if (current !== desired) {
        changedCells.push({ role, key, from: current, to: desired });
      }
    }
  }

  // 5. Bulk upsert. The composite PK (role, permission_key) makes this
  //    a single round trip even at 76+ rows.
  const { error: upsertErr } = await supabase
    .from("role_permissions")
    .upsert(upsertRows, { onConflict: "role,permission_key" });
  if (upsertErr) {
    throw new Error(`Could not save permissions matrix: ${upsertErr.message}`);
  }

  // 6. Drop the in-memory cache so subsequent requireCapability() calls
  //    in THIS process see the new matrix without waiting for the 30s
  //    TTL. Other server instances still get the change within their
  //    own TTL window — that's the accepted trade-off (D.2).
  clearCapabilityCache();

  // 7. Audit log — HIGH severity. Payload includes the diff so an admin
  //    looking at "Recent critical events" on the dashboard can see
  //    EXACTLY what changed (e.g. "TLM gained 2 capabilities, sales lost 1").
  await emitEvent({
    entity_type: "system",
    entity_id: userId ?? "00000000-0000-0000-0000-000000000000",
    event_type: "admin.permissions_changed",
    severity: "high",
    message:
      changedCells.length === 0
        ? "Permissions matrix saved — no changes"
        : `Permissions matrix updated — ${changedCells.length} cell${
            changedCells.length === 1 ? "" : "s"
          } changed`,
    payload: {
      changes: changedCells,
      total_cells: upsertRows.length,
    },
    bestEffort: true,
  });

  // 8. Force every route under (app) to re-render so nav links etc.
  //    reflect the new capabilities right away.
  revalidatePath("/", "layout");
}
