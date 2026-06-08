"use client";

import { createClient } from "@/lib/supabase/client";
import {
  CUSTOM_OPTION_SENTINEL,
  customValueKey,
  isCustomValueKey,
  resolveFactoryInstruction,
  type FactoryInstructionSource,
  type FactoryMapping,
} from "@/lib/types";

/**
 * Fully-resolved data for the factory export (PDF + Excel).
 *
 * This is the canonical shape: the same payload feeds both export formats
 * so they always agree on what the factory sees.
 */
export type ExportLine = {
  product_name: string;
  product_sku: string | null;
  /** Free-text category from `products.category`. */
  product_category: string | null;
  quantity: number;
  /**
   * Compact one-liner summary of the sales config — used in the Order
   * Summary section. e.g. "Battery: 18H · CCT: 4000K · Laser logo: Yes".
   */
  config_summary: string;
  /**
   * One row per sales config value that's been set on the line. Each row
   * carries the sales value, the global factory mapping, the per-line
   * manual override (if any), and the resolved "final" instruction
   * (override > mapping > missing).
   */
  rows: Array<{
    field_name: string;
    sales_value: string;
    /** What the global Factory Mapping says. Empty when no mapping exists. */
    factory_mapping_instruction: string;
    factory_code: string | null;
    /** Per-line override text — empty when no override is set. */
    manual_override: string;
    /** What the factory should actually use. Override if any, else mapping. */
    final_factory_instruction: string;
    source: FactoryInstructionSource;
    /**
     * Per-row note: "OVERRIDDEN" if final differs from mapping,
     * "MISSING" if no mapping exists, otherwise "".
     */
    note: string;
  }>;
  /** Technical-only fields filled by the task list manager (read-only refs). */
  technical_entries: Array<{ label: string; value: string }>;
  internal_notes: string | null;
};

export type ExportData = {
  number: string;
  status: string;
  created_at: string | null;
  submitted_at: string | null;
  validated_at: string | null;
  factory_sent_at: string | null;
  /** Friendly labels — best-effort, falls back to "—" if not resolvable. */
  created_by_label: string;
  validated_by_label: string;
  client: {
    company_name: string;
    country: string | null;
    contact_name: string | null;
    client_code: string | null;
  };
  quotation_number: string | null;
  /** Affair / project name (from the linked quotation). */
  affair_name: string | null;
  shipping_method: string | null;
  production_notes: string | null;
  technical_notes: string | null;
  lines: ExportLine[];
};

/**
 * One-shot fetch + resolve for the export. Used by both ExportPdfButton and
 * ExportExcelButton — keeps the two formats perfectly in sync. Throws on
 * any DB error so the calling button can surface it.
 */
export async function fetchExportData(taskListId: string): Promise<ExportData> {
  const supabase = createClient();

  const [
    { data: task },
    { data: lines },
    { data: fields },
    { data: opts },
    { data: mappings },
  ] = await Promise.all([
    supabase
      .from("production_task_lists")
      .select(
        "number, status, date, shipping_method, production_notes, technical_notes, quotation_id, created_by, submitted_at, validated_at, validated_by, factory_sent_at, clients(company_name, country, contact_name, client_code), documents:quotation_id(number, affair_name)"
      )
      .eq("id", taskListId)
      .maybeSingle(),
    supabase
      .from("production_task_list_lines")
      .select(
        "quantity, config_values, technical_values, factory_overrides, internal_notes, position, product_name, product_sku, product_category, products(name, sku, category, category_id)"
      )
      .eq("task_list_id", taskListId)
      .order("position"),
    supabase
      .from("config_fields")
      .select(
        "id, category_id, field_name, field_type, field_order, internal_only, field_scope, visible_in_task_list, active"
      )
      .eq("active", true)
      .eq("visible_in_task_list", true)
      .order("field_order"),
    supabase
      .from("config_field_options")
      .select("id, field_id, option_value, option_order")
      .order("option_order"),
    supabase
      .from("factory_mappings")
      .select(
        "id, field_id, option_id, factory_instruction, factory_code, notes, active"
      ),
  ]);

  if (!task) throw new Error("Task list not found");

  // User labels = canonical Display Names (Admin → User roles, via
  // user_profiles m052), so the exported factory PDF reads "Maurice", not
  // "sales · 1a2b3c". Resolved client-side here (exportData runs in the
  // browser, so we can't use the server-only resolveUserLabels). Same
  // precedence: display_name → "role · uuid8" → uuid8. Soft-fails to the
  // legacy label if m052 isn't applied.
  const userIds = Array.from(
    new Set(
      [(task as any).created_by, (task as any).validated_by].filter(
        (v): v is string => !!v
      )
    )
  );
  const nameByUser = new Map<string, string>();
  const roleByUser = new Map<string, string>();
  if (userIds.length > 0) {
    const [{ data: profs }, { data: roleRows }] = await Promise.all([
      supabase
        .from("user_profiles")
        .select("user_id, display_name")
        .in("user_id", userIds),
      supabase.from("user_roles").select("user_id, role").in("user_id", userIds),
    ]);
    for (const r of (profs ?? []) as any[]) {
      if (r.display_name && String(r.display_name).trim()) {
        nameByUser.set(r.user_id, String(r.display_name).trim());
      }
    }
    for (const r of (roleRows ?? []) as any[]) {
      if (r.role) roleByUser.set(r.user_id, r.role);
    }
  }
  const userLabel = (uid: string | null | undefined): string => {
    if (!uid) return "—";
    const name = nameByUser.get(uid);
    if (name) return name;
    const role = roleByUser.get(uid);
    const shortId = uid.slice(0, 8);
    return role ? `${role} · ${shortId}` : shortId;
  };

  // Bucket fields by category + scope.
  const salesByCategory = new Map<string, any[]>();
  const technicalByCategory = new Map<string, any[]>();
  for (const f of fields ?? []) {
    const bucket =
      (f.field_scope ?? "sales") === "technical"
        ? technicalByCategory
        : salesByCategory;
    if (!bucket.has(f.category_id)) bucket.set(f.category_id, []);
    bucket.get(f.category_id)!.push(f);
  }

  // Build factory mapping lookups for the resolver.
  const mappingByOption = new Map<string, FactoryMapping>();
  for (const m of (mappings ?? []) as FactoryMapping[]) {
    mappingByOption.set(m.option_id, m);
  }
  const optionIdByFieldValue = new Map<string, string>();
  for (const o of (opts ?? []) as any[]) {
    const f = (fields ?? []).find((x: any) => x.id === o.field_id);
    if (!f || f.field_type !== "dropdown") continue;
    optionIdByFieldValue.set(
      `${f.field_name}|${String(o.option_value).toLowerCase()}`,
      o.id
    );
  }

  // Resolve the displayed sales value for a (field_name, raw stored value).
  // Handles the "Custom…" sentinel and yes/no rendering.
  function displaySalesValue(
    fieldName: string,
    raw: string | undefined,
    cfg: Record<string, string>
  ): string | null {
    if (raw === CUSTOM_OPTION_SENTINEL) {
      raw = cfg[customValueKey(fieldName)] ?? "";
    }
    if (raw == null || raw === "" || raw === "false") return null;
    if (raw === "true") return "Yes";
    // checkbox_group: value is JSON-stringified string[]. Render as
    // comma-separated list for export (e.g. "Marine treatment, Bird spike").
    if (raw.startsWith("[")) {
      try {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length > 0) return arr.join(", ");
        return null;
      } catch {
        // Fall through to plain string.
      }
    }
    return String(raw);
  }

  const exportLines: ExportLine[] = (lines ?? []).map((l: any) => {
    const cid = l.products?.category_id ?? "";
    const salesDefs = salesByCategory.get(cid) ?? [];
    const techDefs = technicalByCategory.get(cid) ?? [];
    const cfg = (l.config_values ?? {}) as Record<string, string>;
    const tech = (l.technical_values ?? {}) as Record<string, string>;
    const factoryOverrides = (l.factory_overrides ?? {}) as Record<
      string,
      string
    >;

    // One row per sales field with a value set, ordered by field_order.
    const seen = new Set<string>();
    const rows: ExportLine["rows"] = [];
    for (const f of salesDefs as any[]) {
      const display = displaySalesValue(f.field_name, cfg[f.field_name], cfg);
      seen.add(f.field_name);
      seen.add(customValueKey(f.field_name));
      if (display === null) continue;
      const manualOverride = factoryOverrides[f.field_name] ?? "";
      if (f.field_type !== "dropdown") {
        // Non-dropdown sales values (text/number/checkbox/textarea) get a
        // row but no factory mapping — they're informational. The "final"
        // is just the sales value itself.
        rows.push({
          field_name: f.field_name,
          sales_value: display,
          factory_mapping_instruction: "",
          factory_code: null,
          manual_override: "",
          final_factory_instruction: display,
          source: "missing",
          note: "Sales field — no mapping required",
        });
        continue;
      }
      const resolved = resolveFactoryInstruction({
        fieldName: f.field_name,
        salesValue: display,
        overrides: factoryOverrides,
        mappingsByOption: mappingByOption,
        optionIdByFieldValue,
      });
      const optionId = optionIdByFieldValue.get(
        `${f.field_name}|${display.toLowerCase()}`
      );
      const mappingText = optionId
        ? mappingByOption.get(optionId)?.factory_instruction ?? ""
        : "";
      let note = "";
      if (resolved.source === "override") note = "OVERRIDDEN";
      else if (resolved.source === "missing") note = "MISSING";
      rows.push({
        field_name: f.field_name,
        sales_value: display,
        factory_mapping_instruction: mappingText,
        factory_code: resolved.factory_code ?? null,
        manual_override: manualOverride,
        final_factory_instruction: resolved.text,
        source: resolved.source,
        note,
      });
    }
    // Legacy keys that have values but no field definition. Surface as
    // information rows so nothing is lost on the factory PDF.
    for (const [k, v] of Object.entries(cfg)) {
      if (seen.has(k)) continue;
      if (isCustomValueKey(k)) continue;
      if (v == null || v === "" || v === "false") continue;
      const display = v === "true" ? "Yes" : String(v);
      rows.push({
        field_name: k,
        sales_value: display,
        factory_mapping_instruction: "",
        factory_code: null,
        manual_override: "",
        final_factory_instruction: display,
        source: "missing",
        note: "Legacy field (no definition)",
      });
    }

    // Compact one-line config summary for the order summary table.
    // Limited to the first ~5 sales values so it stays readable.
    const summaryParts = rows
      .filter((r) => r.source !== "missing" || r.note !== "Sales field — no mapping required" ? true : true)
      .slice(0, 5)
      .map((r) => `${r.field_name}: ${r.sales_value}`);
    const configSummary =
      summaryParts.join(" · ") +
      (rows.length > 5 ? ` · +${rows.length - 5} more` : "");

    // Technical-only entries (TLM-curated refs) — separate section.
    const technical_entries: ExportLine["technical_entries"] = [];
    const techSeen = new Set<string>();
    for (const f of techDefs as any[]) {
      const display = displaySalesValue(f.field_name, tech[f.field_name], tech);
      techSeen.add(f.field_name);
      techSeen.add(customValueKey(f.field_name));
      if (display === null) continue;
      technical_entries.push({ label: f.field_name, value: display });
    }
    for (const [k, v] of Object.entries(tech)) {
      if (techSeen.has(k)) continue;
      if (isCustomValueKey(k)) continue;
      if (v == null || v === "" || v === "false") continue;
      const display = v === "true" ? "Yes" : String(v);
      technical_entries.push({ label: k, value: display });
    }

    return {
      // Fall back to the line's SNAPSHOT (m089) when the catalog product was
      // deleted, so the factory PDF / task list stays readable.
      product_name: l.products?.name ?? l.product_name ?? "—",
      product_sku: l.products?.sku ?? l.product_sku ?? null,
      product_category: l.products?.category ?? l.product_category ?? null,
      quantity: Number(l.quantity || 0),
      config_summary: configSummary,
      rows,
      technical_entries,
      internal_notes: l.internal_notes ?? null,
    };
  });

  return {
    number: (task as any).number ?? "—",
    status: (task as any).status,
    created_at: (task as any).date ?? null,
    submitted_at: (task as any).submitted_at ?? null,
    validated_at: (task as any).validated_at ?? null,
    factory_sent_at: (task as any).factory_sent_at ?? null,
    created_by_label: userLabel((task as any).created_by),
    validated_by_label: userLabel((task as any).validated_by),
    client: {
      company_name: (task as any).clients?.company_name ?? "—",
      country: (task as any).clients?.country ?? null,
      contact_name: (task as any).clients?.contact_name ?? null,
      client_code: (task as any).clients?.client_code ?? null,
    },
    quotation_number: (task as any).documents?.number ?? null,
    affair_name: (task as any).documents?.affair_name ?? null,
    shipping_method: (task as any).shipping_method ?? null,
    production_notes: (task as any).production_notes ?? null,
    technical_notes: (task as any).technical_notes ?? null,
    lines: exportLines,
  };
}
