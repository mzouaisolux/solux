/**
 * Baseline import — session-free core.
 *
 * Pure-ish import logic shared by TWO callers with different trust contexts:
 *   • the gated server action `importBaseline` (actions.ts, "use server") — runs
 *     with a user session + `spec.import` capability gate, passes the RLS client;
 *   • the inbound n8n callback (/api/hooks/import-callback) — has NO session, is
 *     secret-gated, and passes the service-role client.
 *
 * This module is deliberately NOT "use server": exporting an ungated write from
 * a "use server" file would publish it as an unauthenticated RPC. Callers own
 * the auth; this file only owns the logic. It takes the Supabase client as a
 * parameter (so either the RLS or the service client can drive it) and takes the
 * author id explicitly (no getCurrentUserRole()). It does not revalidate any
 * route — the caller decides whether it has a page context to revalidate.
 *
 * `commitImportPlan` is idempotent: spec_fields upsert on (category_id,key),
 * spec_values check-then-update, and a v1.0 spec_versions row only when a family
 * has none. Safe to re-run (e.g. an n8n retry of the same file).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { emitEventWith } from "@/lib/events";
import type {
  ImportCommitResult,
  ImportDryRun,
  ImportRow,
  SpecScope,
  SpecValueKind,
} from "./types";

const VALUE_KINDS: SpecValueKind[] = ["number", "text", "enum", "dimension"];

/** Effective scope for a row: honor the column, else infer from `model`. */
function rowScope(row: ImportRow): SpecScope {
  const s = (row.scope ?? "").trim().toLowerCase();
  if (s === "common" || s === "model") return s;
  return row.model && row.model.trim() ? "model" : "common";
}

/**
 * Parse a spec value into a number after stripping a trailing unit token and
 * normalizing a decimal comma. Returns null when it isn't a clean number.
 *   "6 000 lm" → 6000 · "1,5" → 1.5 · "IP66" → null
 */
function parseSpecNumber(raw: string, unit: string | null): number | null {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  const u = (unit ?? "").trim();
  if (u && s.toLowerCase().endsWith(u.toLowerCase())) {
    s = s.slice(0, s.length - u.length).trim();
  }
  s = s.replace(/\s+/g, "");
  // Both separators present → treat "," as thousands; else "," is the decimal.
  s = s.includes(",") && s.includes(".") ? s.replace(/,/g, "") : s.replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

type PlannedField = {
  key: string;
  label: string;
  scope: SpecScope;
  value_kind: SpecValueKind | null;
  unit: string | null;
  sort: number | null;
};

type PlannedValue = {
  fieldKey: string;
  categoryId: string | null;
  productId: string | null;
  value_number: number | null;
  value_text: string | null;
  unit: string | null;
};

type FamilyPlan = {
  familyName: string;
  categoryId: string;
  fields: Map<string, PlannedField>;
  values: PlannedValue[];
};

type ImportPlan = { families: FamilyPlan[]; report: ImportDryRun };

/**
 * Resolve raw CSV rows against the live catalog into an executable plan + a
 * human report. Shared by dryRunImport (returns the report) and commitImportPlan
 * (executes the plan) so the preview and the commit can never diverge.
 */
export async function buildImportPlan(
  supabase: SupabaseClient,
  rows: ImportRow[]
): Promise<ImportPlan> {
  const warnings: string[] = [];

  // Catalog: category name (case-insensitive) → id.
  const { data: cats } = await supabase.from("product_categories").select("id, name");
  const categories = (cats ?? []) as { id: string; name: string }[];
  const catByName = new Map<string, { id: string; name: string }>();
  for (const c of categories) catByName.set(c.name.trim().toLowerCase(), c);

  // Distinct family names in the CSV (first-seen original casing).
  const familyOrder: string[] = [];
  const familySeen = new Map<string, string>();
  for (const r of rows) {
    const key = (r.family ?? "").trim().toLowerCase();
    if (!key) continue;
    if (!familySeen.has(key)) {
      familySeen.set(key, (r.family ?? "").trim());
      familyOrder.push(key);
    }
  }

  const familiesMatched: string[] = [];
  const familiesUnmatched: string[] = [];
  const planByFamily = new Map<string, FamilyPlan>();
  for (const key of familyOrder) {
    const original = familySeen.get(key) as string;
    const cat = catByName.get(key);
    if (cat) {
      familiesMatched.push(original);
      planByFamily.set(key, { familyName: cat.name, categoryId: cat.id, fields: new Map(), values: [] });
    } else {
      familiesUnmatched.push(original);
    }
  }

  // Products for the matched categories (sku → id, then name → id).
  const matchedCatIds = Array.from(planByFamily.values()).map((p) => p.categoryId);
  const productBySku = new Map<string, Map<string, string>>(); // catId → (lower sku → id)
  const productByName = new Map<string, Map<string, string>>(); // catId → (lower name → id)
  if (matchedCatIds.length > 0) {
    const { data: prods } = await supabase
      .from("products")
      .select("id, sku, name, category_id")
      .in("category_id", matchedCatIds);
    for (const p of (prods ?? []) as { id: string; sku: string | null; name: string; category_id: string | null }[]) {
      if (!p.category_id) continue;
      if (!productBySku.has(p.category_id)) productBySku.set(p.category_id, new Map());
      if (!productByName.has(p.category_id)) productByName.set(p.category_id, new Map());
      if (p.sku) productBySku.get(p.category_id)!.set(p.sku.trim().toLowerCase(), p.id);
      productByName.get(p.category_id)!.set(p.name.trim().toLowerCase(), p.id);
    }
  }

  const productsUnmatched: { family: string; model: string }[] = [];
  const matchedProductIds = new Set<string>();

  rows.forEach((r, i) => {
    const line = i + 2; // +1 for header, +1 for 1-based
    const familyKey = (r.family ?? "").trim().toLowerCase();
    if (!familyKey) return; // wholly blank row → ignore silently
    const plan = planByFamily.get(familyKey);
    if (!plan) return; // unmatched family already reported

    const fieldKey = (r.field_key ?? "").trim();
    if (!fieldKey) {
      warnings.push(`Row ${line}: missing field_key — skipped.`);
      return;
    }

    const scope = rowScope(r);
    let kind = (r.value_kind ?? "").trim().toLowerCase() as SpecValueKind;
    if (r.value_kind && !VALUE_KINDS.includes(kind)) {
      warnings.push(`Row ${line}: unknown value_kind "${r.value_kind}" — treated as text.`);
      kind = "text";
    }
    if (!r.value_kind) kind = "text";
    const unit = (r.unit ?? "").trim() || null;
    const label = (r.label ?? "").trim() || fieldKey;
    const sortRaw = (r.sort ?? "").trim();
    const sort = sortRaw === "" ? null : Number.isFinite(Number(sortRaw)) ? Number(sortRaw) : null;

    // Register / merge the field definition for this family.
    plan.fields.set(fieldKey, { key: fieldKey, label, scope, value_kind: kind, unit, sort });

    // Resolve the write target.
    let categoryId: string | null = null;
    let productId: string | null = null;
    if (scope === "common") {
      categoryId = plan.categoryId;
    } else {
      const model = (r.model ?? "").trim();
      if (!model) {
        warnings.push(`Row ${line}: scope "model" but no model given — skipped.`);
        return;
      }
      const bySku = productBySku.get(plan.categoryId);
      const byName = productByName.get(plan.categoryId);
      const pid = bySku?.get(model.toLowerCase()) ?? byName?.get(model.toLowerCase()) ?? null;
      if (!pid) {
        productsUnmatched.push({ family: plan.familyName, model });
        return;
      }
      productId = pid;
      matchedProductIds.add(pid);
    }

    // Type the value.
    const rawValue = (r.value ?? "").trim();
    let value_number: number | null = null;
    let value_text: string | null = null;
    if (rawValue === "") {
      // empty value — still creates the field, but no value row.
      return;
    }
    if (kind === "number" || kind === "dimension") {
      const n = parseSpecNumber(rawValue, unit);
      if (n == null) {
        warnings.push(`Row ${line}: value "${rawValue}" for "${fieldKey}" is not a number — stored as text.`);
        value_text = rawValue;
      } else {
        value_number = n;
      }
    } else {
      value_text = rawValue;
    }

    plan.values.push({ fieldKey, categoryId, productId, value_number, value_text, unit });
  });

  const families = Array.from(planByFamily.values());
  const fieldCount = families.reduce((acc, f) => acc + f.fields.size, 0);
  const valueCount = families.reduce((acc, f) => acc + f.values.length, 0);

  return {
    families,
    report: {
      familiesMatched,
      familiesUnmatched,
      productsMatched: matchedProductIds.size,
      productsUnmatched,
      fieldCount,
      valueCount,
      warnings,
    },
  };
}

/**
 * Commit the baseline import (idempotent). Session-free: takes the client and
 * the author id explicitly, and does NOT revalidate — the caller owns auth and
 * cache invalidation.
 *   - upsert spec_fields on (category_id, key) from the row field defs,
 *   - write spec_values (typed) at category (common) or product (model) level,
 *     updating an existing row rather than duplicating (like approveRequest),
 *   - insert a v1.0 spec_versions row per family ONLY if it has none yet,
 *   - emit spec.published (best-effort) per family.
 * Unmatched families / products are skipped and collected into `skipped`.
 */
export async function commitImportPlan(
  supabase: SupabaseClient,
  rows: ImportRow[],
  opts: { authorId: string | null }
): Promise<ImportCommitResult> {
  const { families, report } = await buildImportPlan(supabase, rows ?? []);

  let fieldsWritten = 0;
  let valuesWritten = 0;

  for (const fam of families) {
    // 1. Upsert the spec_fields schema for this family.
    for (const f of fam.fields.values()) {
      const { error } = await supabase.from("spec_fields").upsert(
        {
          category_id: fam.categoryId,
          key: f.key,
          scope: f.scope,
          label: f.label,
          value_kind: f.value_kind,
          unit: f.unit,
          sort: f.sort ?? 0,
        },
        { onConflict: "category_id,key" }
      );
      if (error) throw new Error(`Could not upsert spec field "${f.key}": ${error.message}`);
      fieldsWritten += 1;
    }

    // Resolve field key → id for this category.
    const { data: fieldRows } = await supabase
      .from("spec_fields")
      .select("id, key")
      .eq("category_id", fam.categoryId);
    const fieldIdByKey = new Map<string, string>();
    for (const fr of (fieldRows ?? []) as { id: string; key: string }[]) fieldIdByKey.set(fr.key, fr.id);

    // 2. Write the values (check-then-update, else insert).
    for (const v of fam.values) {
      const fieldId = fieldIdByKey.get(v.fieldKey);
      if (!fieldId) continue;
      const target = v.productId
        ? { column: "product_id" as const, id: v.productId }
        : { column: "category_id" as const, id: v.categoryId as string };
      if (!target.id) continue;

      const { data: existing } = await supabase
        .from("spec_values")
        .select("id")
        .eq("field_id", fieldId)
        .eq(target.column, target.id)
        .maybeSingle();

      const payload = {
        value_number: v.value_number,
        value_text: v.value_text,
        unit: v.unit,
        updated_at: new Date().toISOString(),
      };

      if (existing) {
        const { error } = await supabase
          .from("spec_values")
          .update(payload)
          .eq("id", (existing as { id: string }).id);
        if (error) throw new Error(`Could not update spec value: ${error.message}`);
      } else {
        const { error } = await supabase.from("spec_values").insert({
          field_id: fieldId,
          [target.column]: target.id,
          ...payload,
        });
        if (error) {
          // 23505 = a concurrent import (n8n retry) inserted this exact
          // (field_id, scope) first. The unique index (m171) makes this safe:
          // fall back to updating the row that won the race instead of failing.
          if (error.code === "23505") {
            const { error: raceErr } = await supabase
              .from("spec_values")
              .update(payload)
              .eq("field_id", fieldId)
              .eq(target.column, target.id);
            if (raceErr) throw new Error(`Could not update spec value: ${raceErr.message}`);
          } else {
            throw new Error(`Could not insert spec value: ${error.message}`);
          }
        }
      }
      valuesWritten += 1;
    }

    // 3. Seed an initial v1.0 version only if the family has none.
    const { data: anyVersion } = await supabase
      .from("spec_versions")
      .select("id")
      .eq("category_id", fam.categoryId)
      .limit(1)
      .maybeSingle();
    if (!anyVersion) {
      const { error } = await supabase.from("spec_versions").insert({
        category_id: fam.categoryId,
        version: "v1.0",
        author: opts.authorId,
        reason: "Baseline import",
        changes_json: [],
      });
      // 23505 = a concurrent import already seeded v1.0 for this family. The
      // unique index (m171) makes that a no-op, not an error — swallow it.
      if (error && error.code !== "23505") {
        throw new Error(`Could not create initial version: ${error.message}`);
      }
    }

    // Emit via the SAME client that drove the writes + the explicit author, so
    // this works whether the caller is the gated action (cookie client + user)
    // or the n8n callback (service client + null/system actor).
    await emitEventWith(supabase, opts.authorId, {
      entity_type: "spec_change_request",
      entity_id: fam.categoryId,
      event_type: "spec.published",
      message: `Baseline spec import — ${fam.familyName}`,
      payload: { category_id: fam.categoryId, source: "baseline_import" },
      bestEffort: true,
    });
  }

  // Skipped families / products → a flat, readable report.
  const skipped: string[] = [
    ...report.familiesUnmatched.map((f) => `Family not matched: ${f}`),
    ...report.productsUnmatched.map((p) => `Model not matched: ${p.family} / ${p.model}`),
  ];

  return { families: families.length, fields: fieldsWritten, values: valuesWritten, skipped };
}
