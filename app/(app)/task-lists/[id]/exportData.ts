"use client";

import { createClient } from "@/lib/supabase/client";
import {
  CUSTOM_OPTION_SENTINEL,
  customValueKey,
  isCustomValueKey,
  optionLookupKey,
  resolveFactoryInstruction,
  type FactoryInstructionSource,
  type FactoryMapping,
} from "@/lib/types";
import {
  normalizeFactoryExtras,
  resolveFactoryExtras,
  type ResolvedFactoryExtra,
} from "@/lib/factory-extras";
import {
  normalizeStickerRequirements,
  type StickerRequirements,
} from "@/lib/stickers";
import { normalizeRiskFlags, type RiskFlags } from "@/lib/risks";
import { attachmentTypeLabel } from "@/lib/attachments";
import { BATTERY_CELL_KEY } from "@/lib/production-dossier";
import type { LightingProgram, DialuxConfiguration } from "@/lib/lighting/types";

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
  /** m135 — manual item (pole/mast/non-catalog): tag + free-text specs. */
  is_manual: boolean;
  manual_specs: string | null;
  /**
   * m071 — additional factory attributes (controller, BMS ref, cable…),
   * resolved client preset + order override, exactly as shown on the line.
   */
  factory_extras: ResolvedFactoryExtra[];
  /** Production cell technology picked by the TLM (32700/26650/18650/G2W). */
  battery_cell_type: string | null;
};

/** File available to the production package (affair attachment or lighting doc). */
export type ExportAttachment = {
  file_name: string;
  mime_type: string | null;
  storage_path: string;
  /** Human type label, e.g. "DIALux report", "Technical specification". */
  type_label: string;
  note: string | null;
  /** false = explicitly hidden from the factory audience — kept out of the dossier. */
  visible_factory: boolean;
};

/** m144 — the approved lighting configuration for this production command. */
export type ExportLighting = {
  lighting_power: number | null;
  operating_hours: number | null;
  lighting_program: LightingProgram;
  approved_optics: string | null;
  energy_study_name: string | null;
  dialux_name: string | null;
  /** DIALux production configurations extracted for review (if any). */
  dialux_configurations: DialuxConfiguration[];
};

/** Commercial/logistics context inherited from the linked quotation. */
export type ExportLogistics = {
  incoterm: string | null;
  freight_type: string | null;
  port_of_loading: string | null;
  port_of_destination: string | null;
  production_mode: string | null;
  production_days: number | null;
  production_date: string | null;
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
  /** m134 — the customer's original need, as captured by sales. */
  original_sales_request: string | null;
  /** Transport / production terms from the linked quotation (no prices). */
  logistics: ExportLogistics | null;
  /** m061 — sticker & branding requirements (normalized full spec). */
  stickers: StickerRequirements | null;
  /** m062 — known risks / warnings (normalized full spec). */
  risks: RiskFlags | null;
  /** m144 — lighting program / energy configuration, when set up. */
  lighting: ExportLighting | null;
  /** Affair attachments + lighting study documents, for the appendix. */
  attachments: ExportAttachment[];
};

/**
 * One-shot fetch + resolve for the export. Used by both the Production
 * Dossier pipeline (dossier.ts) and ExportExcelButton — keeps the formats
 * perfectly in sync. Throws on any DB error so the calling button can
 * surface it.
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
        "number, status, date, shipping_method, production_notes, technical_notes, quotation_id, client_id, created_by, submitted_at, validated_at, validated_by, factory_sent_at, clients(company_name, country, contact_name, client_code), documents:quotation_id(number, affair_name, incoterm, freight_type, port_of_loading, port_of_destination, production_mode, production_days, production_date)"
      )
      .eq("id", taskListId)
      .maybeSingle(),
    supabase
      .from("production_task_list_lines")
      .select(
        // m135 manual-item columns (is_manual, manual_specs) are fetched
        // separately + defensively below so exports work before the migration.
        "id, quantity, config_values, technical_values, factory_overrides, internal_notes, position, product_id, product_name, product_sku, product_category, products(name, sku, category, category_id)"
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

  // m135 — manual-item columns, fetched defensively (empty map if the migration
  // isn't applied yet) so the factory export never 500s on a missing column.
  const manualByLine = new Map<
    string,
    { is_manual: boolean; manual_specs: string | null }
  >();
  {
    const { data, error } = await supabase
      .from("production_task_list_lines")
      .select("id, is_manual, manual_specs")
      .eq("task_list_id", taskListId);
    if (!error) {
      for (const r of (data ?? []) as any[]) {
        manualByLine.set(r.id, {
          is_manual: r.is_manual === true,
          manual_specs: r.manual_specs ?? null,
        });
      }
    }
  }

  // ---- Dossier sections — every fetch below is DEFENSIVE (missing migration
  // or RLS-empty result just leaves the section empty; the export never 500s,
  // same resilience pattern as the m135 block above). ----

  // m061 stickers + m062 risk flags (jsonb columns on the header row).
  let stickers: StickerRequirements | null = null;
  let risks: RiskFlags | null = null;
  {
    const { data, error } = await supabase
      .from("production_task_lists")
      .select("sticker_requirements, risk_flags")
      .eq("id", taskListId)
      .maybeSingle();
    if (!error && data) {
      stickers = normalizeStickerRequirements((data as any).sticker_requirements);
      risks = normalizeRiskFlags((data as any).risk_flags);
    }
  }

  // m134 — original sales request (separate select: column may be absent).
  let originalSalesRequest: string | null = null;
  {
    const { data, error } = await supabase
      .from("production_task_lists")
      .select("original_sales_request")
      .eq("id", taskListId)
      .maybeSingle();
    if (!error) originalSalesRequest = (data as any)?.original_sales_request ?? null;
  }

  // m144 — lighting setup, anchored on the proforma (document_id = quotation_id).
  let lighting: ExportLighting | null = null;
  let lightingDocs: ExportAttachment[] = [];
  if ((task as any).quotation_id) {
    const { data, error } = await supabase
      .from("product_lighting_setups")
      .select(
        "lighting_power, operating_hours, lighting_program, approved_optics, energy_study_path, energy_study_name, dialux_path, dialux_name, ai_extracted"
      )
      .eq("document_id", (task as any).quotation_id)
      .maybeSingle();
    if (!error && data) {
      const program = Array.isArray((data as any).lighting_program)
        ? ((data as any).lighting_program as LightingProgram)
        : [];
      const dialuxConfigs = Array.isArray(
        (data as any).ai_extracted?.dialux?.configurations
      )
        ? ((data as any).ai_extracted.dialux
            .configurations as DialuxConfiguration[])
        : [];
      lighting = {
        lighting_power: (data as any).lighting_power ?? null,
        operating_hours: (data as any).operating_hours ?? null,
        lighting_program: program,
        approved_optics: (data as any).approved_optics ?? null,
        energy_study_name: (data as any).energy_study_name ?? null,
        dialux_name: (data as any).dialux_name ?? null,
        dialux_configurations: dialuxConfigs,
      };
      // The lighting studies live on the setup row (not in `attachments`) —
      // surface them as dossier files so they land in the appendix too.
      if ((data as any).energy_study_path) {
        lightingDocs.push({
          file_name: (data as any).energy_study_name ?? "Energy study.pdf",
          mime_type: null,
          storage_path: (data as any).energy_study_path,
          type_label: "Energy study",
          note: null,
          visible_factory: true,
        });
      }
      if ((data as any).dialux_path) {
        lightingDocs.push({
          file_name: (data as any).dialux_name ?? "DIALux report",
          mime_type: null,
          storage_path: (data as any).dialux_path,
          type_label: "DIALux report",
          note: null,
          visible_factory: true,
        });
      }
    }
  }

  // m071 — client technical presets (instruction layer + extras layer) and
  // the per-line order extras. Same 3-tier model as the task-list page:
  // order override > client preset > global mapping.
  const presetByProduct = new Map<string, Record<string, string>>();
  const clientExtrasByProduct = new Map<string, ReturnType<typeof normalizeFactoryExtras>>();
  const orderExtrasByLine = new Map<string, ReturnType<typeof normalizeFactoryExtras>>();
  {
    const productIds = Array.from(
      new Set(((lines ?? []) as any[]).map((l) => l.product_id).filter(Boolean))
    ) as string[];
    if ((task as any).client_id && productIds.length > 0) {
      const { data, error } = await supabase
        .from("client_technical_presets")
        .select("product_id, mapping, extras")
        .eq("client_id", (task as any).client_id)
        .in("product_id", productIds);
      if (!error) {
        for (const r of (data ?? []) as any[]) {
          const m = r.mapping;
          if (m && typeof m === "object" && !Array.isArray(m)) {
            const clean: Record<string, string> = {};
            for (const [k, v] of Object.entries(m)) {
              if (typeof v === "string" && v.trim() !== "") clean[k] = v;
            }
            presetByProduct.set(r.product_id, clean);
          }
          clientExtrasByProduct.set(r.product_id, normalizeFactoryExtras(r.extras));
        }
      }
    }
    const { data: extraRows, error: extraErr } = await supabase
      .from("production_task_list_lines")
      .select("id, factory_extras")
      .eq("task_list_id", taskListId);
    if (!extraErr) {
      for (const r of (extraRows ?? []) as any[]) {
        orderExtrasByLine.set(
          r.id,
          normalizeFactoryExtras(r.factory_extras, { keepEmpty: true })
        );
      }
    }
  }

  // m060 — affair attachments (drawings, tender docs, artwork…). Keyed on the
  // affair root of the linked quotation (root_document_id ?? quotation_id).
  let attachments: ExportAttachment[] = [];
  if ((task as any).quotation_id) {
    let affairRoot: string = (task as any).quotation_id;
    {
      const { data } = await supabase
        .from("documents")
        .select("id, root_document_id")
        .eq("id", (task as any).quotation_id)
        .maybeSingle();
      affairRoot = ((data as any)?.root_document_id as string | null) ?? affairRoot;
    }
    const { data, error } = await supabase
      .from("attachments")
      .select(
        "file_name, mime_type, storage_path, attachment_type, note, visible_factory"
      )
      .eq("affair_id", affairRoot)
      .order("created_at", { ascending: true });
    if (!error) {
      attachments = ((data ?? []) as any[]).map((r) => ({
        file_name: r.file_name ?? "file",
        mime_type: r.mime_type ?? null,
        storage_path: r.storage_path,
        type_label: attachmentTypeLabel(r.attachment_type),
        note: r.note ?? null,
        visible_factory: r.visible_factory !== false,
      }));
    }
  }
  attachments = [...lightingDocs, ...attachments];

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
      optionLookupKey(f.category_id, f.field_name, o.option_value),
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
        categoryId: cid,
        fieldName: f.field_name,
        salesValue: display,
        overrides: factoryOverrides,
        // Client preset layer (m071) — same 3-tier resolution as the page,
        // so the dossier prints EXACTLY what the TLM validated on screen.
        clientOverrides: l.product_id
          ? presetByProduct.get(l.product_id) ?? null
          : null,
        mappingsByOption: mappingByOption,
        optionIdByFieldValue,
      });
      const optionId = optionIdByFieldValue.get(
        optionLookupKey(cid, f.field_name, display)
      );
      const mappingText = optionId
        ? mappingByOption.get(optionId)?.factory_instruction ?? ""
        : "";
      let note = "";
      if (resolved.source === "override") note = "OVERRIDDEN";
      else if (resolved.source === "client_preset") note = "CLIENT PRESET";
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
      // deleted, so the factory PDF / task list stays readable. For a MANUAL
      // item (m135) the snapshot IS the name (there is no catalog product).
      product_name: l.products?.name ?? l.product_name ?? "—",
      product_sku: l.products?.sku ?? l.product_sku ?? null,
      product_category: l.products?.category ?? l.product_category ?? null,
      quantity: Number(l.quantity || 0),
      config_summary: configSummary,
      rows,
      technical_entries,
      internal_notes: l.internal_notes ?? null,
      is_manual: manualByLine.get(l.id)?.is_manual ?? false,
      manual_specs: manualByLine.get(l.id)?.manual_specs ?? null,
      factory_extras: resolveFactoryExtras(
        l.product_id ? clientExtrasByProduct.get(l.product_id) ?? [] : [],
        orderExtrasByLine.get(l.id) ?? []
      ),
      battery_cell_type:
        typeof tech[BATTERY_CELL_KEY] === "string" &&
        tech[BATTERY_CELL_KEY].trim() !== ""
          ? tech[BATTERY_CELL_KEY]
          : null,
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
    original_sales_request: originalSalesRequest,
    logistics: (task as any).documents
      ? {
          incoterm: (task as any).documents.incoterm ?? null,
          freight_type: (task as any).documents.freight_type ?? null,
          port_of_loading: (task as any).documents.port_of_loading ?? null,
          port_of_destination:
            (task as any).documents.port_of_destination ?? null,
          production_mode: (task as any).documents.production_mode ?? null,
          production_days: (task as any).documents.production_days ?? null,
          production_date: (task as any).documents.production_date ?? null,
        }
      : null,
    stickers,
    risks,
    lighting,
    attachments,
  };
}
