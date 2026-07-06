"use server";

import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import type { BulkSavePayload } from "@/lib/factory-mapping-grid";

/**
 * Factory Mapping — bulk save (the grid's single "Save mappings" action).
 *
 * The page is a spreadsheet: users edit dozens of cells (typing, Excel paste,
 * cross-family copy) and commit ONCE. The client derives the payload with the
 * pure helper (lib/factory-mapping-grid.ts buildBulkSavePayload):
 *   - upserts: rows whose instruction/code changed (conflict key = the UNIQUE
 *     option_id, so re-running is idempotent),
 *   - deletes: previously-mapped options whose instruction was cleared
 *     (factory_instruction is NOT NULL — no mapping row without one).
 *
 * notes/active are NOT grid columns: existing values are PRESERVED by
 * re-reading them here (PostgREST bulk upsert needs uniform keys, so the final
 * rows are built server-side). Entries carrying notes/active (from the
 * cross-family copy, which clones them from the source) win over preserved.
 *
 * The old per-row actions (upsert/delete/copy-between-families) are gone with
 * the per-row UI: the grid owns editing, and the cross-family copy now runs
 * CLIENT-side on the working state (lib/factory-mapping-clone.ts is pure) so
 * copied values are reviewable BEFORE this save commits them.
 *
 * Capability-driven like the rest of the module: the same
 * `factory_mapping.access` key gates the page (UI), this action, and RLS
 * (migration 088) — no role bypass, so the /permissions toggle stays real.
 */

const MAX_ROWS = 5000; // hard ceiling — far above any real family sweep
const CHUNK = 200;

export type BulkSaveResult = { saved: number; deleted: number };

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function bulkSaveFactoryMappings(
  payload: BulkSavePayload
): Promise<BulkSaveResult> {
  await requireCapability("factory_mapping.access");

  const upserts = Array.isArray(payload?.upserts) ? payload.upserts : [];
  const deletes = Array.isArray(payload?.deletes) ? payload.deletes : [];
  if (upserts.length + deletes.length === 0) return { saved: 0, deleted: 0 };
  if (upserts.length + deletes.length > MAX_ROWS) {
    throw new Error(`Too many changes in one save (max ${MAX_ROWS}).`);
  }

  // Validate shape server-side — the client is not trusted.
  const cleanUpserts = upserts.map((u) => {
    const field_id = String(u?.field_id ?? "").trim();
    const option_id = String(u?.option_id ?? "").trim();
    const instruction = String(u?.factory_instruction ?? "").trim();
    if (!field_id || !option_id) throw new Error("Malformed mapping entry.");
    if (!instruction) throw new Error("Factory instruction is required.");
    return {
      field_id,
      option_id,
      factory_instruction: instruction,
      factory_code:
        u?.factory_code == null ? null : String(u.factory_code).trim() || null,
      notes:
        u?.notes === undefined
          ? undefined
          : u.notes == null
            ? null
            : String(u.notes),
      active: u?.active === undefined ? undefined : Boolean(u.active),
    };
  });
  const cleanDeletes = deletes
    .map((d) => String(d ?? "").trim())
    .filter(Boolean);

  const supabase = createClient();
  const now = new Date().toISOString();

  // Preserve notes/active for rows the grid doesn't edit: read the existing
  // values, then build UNIFORM upsert rows (PostgREST bulk upsert requires
  // every object to carry the same keys).
  const existingByOption = new Map<
    string,
    { notes: string | null; active: boolean }
  >();
  for (const ids of chunk(cleanUpserts.map((u) => u.option_id), CHUNK)) {
    const { data, error } = await supabase
      .from("factory_mappings")
      .select("option_id, notes, active")
      .in("option_id", ids);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as any[]) {
      existingByOption.set(r.option_id, {
        notes: r.notes ?? null,
        active: r.active ?? true,
      });
    }
  }

  const rows = cleanUpserts.map((u) => {
    const prev = existingByOption.get(u.option_id);
    return {
      field_id: u.field_id,
      option_id: u.option_id,
      factory_instruction: u.factory_instruction,
      factory_code: u.factory_code,
      notes: u.notes !== undefined ? u.notes : prev?.notes ?? null,
      active: u.active !== undefined ? u.active : prev?.active ?? true,
      updated_at: now,
    };
  });

  for (const batch of chunk(rows, CHUNK)) {
    const { error } = await supabase
      .from("factory_mappings")
      .upsert(batch, { onConflict: "option_id" });
    if (error) throw new Error(error.message);
  }

  for (const ids of chunk(cleanDeletes, CHUNK)) {
    const { error } = await supabase
      .from("factory_mappings")
      .delete()
      .in("option_id", ids);
    if (error) throw new Error(error.message);
  }

  // Same surfaces as the old per-row save: the mapping page itself + every
  // task list (factory mappings are GLOBAL — a change can affect ANY task
  // list's missing-mapping gate).
  revalidatePath("/factory-mapping");
  revalidatePath("/task-lists", "layout");

  return { saved: rows.length, deleted: cleanDeletes.length };
}
