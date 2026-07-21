"use server";

/**
 * Terminology administration — server actions (m177).
 *
 * The centralized fixed translations used by the Task List, the exports and
 * the factory dossier. Gated on `terminology.manage` (super_admin + admin
 * floor, plus the Task List Manager the owner granted) — checked here AND in
 * RLS, so a browser without the capability cannot write a term.
 *
 * There is deliberately no "translate" action: nothing in this system
 * machine-translates, and a term that isn't validated falls back to English
 * rather than being invented.
 */

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { requireCapabilityOrAdmin } from "@/lib/permissions";
import { getCurrentUserRole } from "@/lib/auth";
import {
  TERM_CATEGORIES,
  TERM_STATUSES,
  type TermCategory,
  type TermStatus,
} from "@/lib/terminology";

const MISSING_TABLE =
  "Terminology table missing — apply migration m177 (177_terminology.sql) in Supabase.";

function str(fd: FormData, key: string): string | null {
  const v = fd.get(key);
  return v == null ? null : String(v).trim() || null;
}

function category(v: string | null): TermCategory {
  return (TERM_CATEGORIES as readonly string[]).includes(v ?? "")
    ? (v as TermCategory)
    : "field";
}

function status(v: string | null): TermStatus {
  return (TERM_STATUSES as readonly string[]).includes(v ?? "")
    ? (v as TermStatus)
    : "draft";
}

/** Keys are stable identifiers the code resolves — keep them machine-safe. */
const KEY_RE = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;

/**
 * Create or update one term. Upsert on `key`: the admin lists catalogued
 * terms that have no row yet (pre-seed or a key added in code), and saving
 * one materializes it.
 */
export async function saveTerm(formData: FormData) {
  await requireCapabilityOrAdmin("terminology.manage");
  const { userId } = await getCurrentUserRole();

  const key = str(formData, "key");
  if (!key) throw new Error("A term key is required.");
  if (!KEY_RE.test(key)) {
    throw new Error(
      `Invalid key "${key}" — use lowercase module.name segments, e.g. "table.qty".`
    );
  }

  const en = str(formData, "en");
  if (!en) {
    // English is the last fallback before the key itself: without it a term
    // could render as a raw identifier on a factory document.
    throw new Error("The English value is required — it is the fallback for every locale.");
  }

  const nextStatus = status(str(formData, "status"));
  const zh = str(formData, "zh");
  if (nextStatus === "validated" && !zh) {
    throw new Error(
      "A term cannot be marked validated without a Chinese value — mark it draft until the translation is ready."
    );
  }

  const supabase = createClient();
  const { error } = await supabase.from("terminology").upsert(
    {
      key,
      category: category(str(formData, "category")),
      en,
      zh,
      fr: str(formData, "fr"),
      status: nextStatus,
      notes: str(formData, "notes"),
      updated_at: new Date().toISOString(),
      updated_by: userId ?? null,
    },
    { onConflict: "key" }
  );
  if (error) {
    throw new Error(/terminology/i.test(error.message ?? "") ? MISSING_TABLE : error.message);
  }

  revalidatePath("/admin/terminology");
}

/**
 * Delete a term row. The built-in catalog still provides the default, so the
 * vocabulary keeps rendering — this only discards the override.
 */
export async function deleteTerm(formData: FormData) {
  await requireCapabilityOrAdmin("terminology.manage");

  const key = str(formData, "key");
  if (!key) throw new Error("A term key is required.");

  const supabase = createClient();
  const { error } = await supabase.from("terminology").delete().eq("key", key);
  if (error) {
    throw new Error(/terminology/i.test(error.message ?? "") ? MISSING_TABLE : error.message);
  }

  revalidatePath("/admin/terminology");
}
