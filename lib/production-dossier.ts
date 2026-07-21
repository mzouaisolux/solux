/**
 * Production Dossier — pure vocabulary + planning helpers.
 *
 * The dossier is the COMPLETE production package generated from a validated
 * task list: every section the factory needs (customer, project, product
 * configuration, factory instructions, battery, lighting program, stickers,
 * transport, QA, notes) plus an appendix that embeds the uploaded documents,
 * so the factory receives ONE self-sufficient PDF.
 *
 * Client + server safe (no DB, no pdf libraries). The @react-pdf component
 * (components/ProductionDossierPDF.tsx) and the pdf-lib appendix merger
 * (lib/pdf-merge.ts) both consume this module so the section vocabulary,
 * appendix plan and battery detection live in exactly one place.
 */

import type {
  ManualLanguage,
  PackagingVersion,
  UserManualBrand,
} from "@/lib/industrial-spec";

/** Bilingual section title — Simplified Chinese first, English underneath. */
export type BiTitle = { zh: string; en: string };

/**
 * Section title catalog. Natural manufacturing Chinese (as validated by the
 * owner's spec), never machine-literal.
 *
 * ⚠ m177 — EDITING THE STRINGS BELOW NO LONGER CHANGES THE DOSSIER. The PDF
 * resolves every section title through the centralized terminology catalog
 * (lib/terminology.ts, keys `section.<key>`), which is editable in
 * Admin → Terminology; this map is now consumed for its KEYS and its
 * `DossierSectionKey` type. The values are kept in sync as the built-in
 * fallback — change lib/terminology.ts first, and mirror it here.
 *
 * Adding a section = a row here AND a `section.<key>` term in the catalog.
 */
export const DOSSIER_SECTIONS = {
  dossier: { zh: "生产档案", en: "Production Dossier" },
  customer: { zh: "客户信息", en: "Customer Information" },
  project: { zh: "项目信息", en: "Project Information" },
  order_summary: { zh: "订单摘要", en: "Order Summary" },
  production_notes: { zh: "生产说明", en: "Production Notes" },
  product_configuration: { zh: "产品配置", en: "Product Configuration" },
  factory_mapping: { zh: "工厂映射", en: "Factory Mapping" },
  factory_instructions: { zh: "工厂生产说明", en: "Factory Instructions" },
  battery: { zh: "电池信息", en: "Battery Information" },
  battery_type: { zh: "电池类型", en: "Battery Type" },
  technical_refs: { zh: "技术参数", en: "Technical References" },
  factory_extras: { zh: "工厂附加参数", en: "Additional Factory Parameters" },
  lighting_program: { zh: "灯光程序", en: "Lighting Program" },
  energy: { zh: "能源配置", en: "Energy Configuration" },
  stickers: { zh: "标签信息", en: "Stickers" },
  industrial_file: { zh: "工业生产规格", en: "Industrial Production File" },
  tilt_angle: { zh: "太阳能板倾角", en: "Solar Panel Tilt Angle" },
  pole_accessories: { zh: "灯杆配件", en: "Pole Accessories" },
  packaging: { zh: "包装要求", en: "Packaging" },
  user_manual: { zh: "用户手册", en: "User Manual" },
  spare_parts: { zh: "备品备件", en: "Spare Parts" },
  transport: { zh: "运输信息", en: "Transport Information" },
  quality: { zh: "质量控制", en: "Quality Control" },
  internal_notes: { zh: "内部备注", en: "Internal Notes" },
  uploads: { zh: "上传文件", en: "Uploaded Documents" },
  appendix: { zh: "附录", en: "Appendix" },
} as const satisfies Record<string, BiTitle>;

export type DossierSectionKey = keyof typeof DOSSIER_SECTIONS;

/* ---------------------------------------------------------------------------
   Industrial production file (m159) — bilingual labels for the enum values
   of lib/industrial-spec.ts, so the dossier prints natural manufacturing
   Chinese instead of raw enum codes. Kept here (not in industrial-spec.ts)
   because the Chinese vocabulary is a DOSSIER concern.
   --------------------------------------------------------------------------- */

/* The bilingual enum labels that used to live here (PACKAGING_VERSION_TITLES,
   MANUAL_BRAND_TITLES, MANUAL_LANGUAGE_TITLES) moved to the centralized
   terminology catalog in m177 — lib/terminology.ts, keys `enum.packaging.*`,
   `enum.manual_brand.*` and `enum.manual_language.*`. They are editable in
   Admin → Terminology; keeping a second copy here is exactly the duplication
   m177 removed. */

/* ---------------------------------------------------------------------------
   Battery detection — the Battery section aggregates every battery-bearing
   value scattered across the line (sales config, technical values, factory
   extras) so the factory reads ONE battery block per product.
   --------------------------------------------------------------------------- */

/** technical_values key holding the production cell technology (TLM-picked). */
export const BATTERY_CELL_KEY = "Battery Cell Type";

/** Field / label names that belong in the Battery section. Underscored keys
 *  (`cell_reference`, `bms_reference`) are normalized so \b matches them. */
export function isBatteryLabel(label: string): boolean {
  return /batter|\bcell\b|\bbms\b|autonom/i.test(label.replace(/_/g, " "));
}

/* ---------------------------------------------------------------------------
   Appendix planning — which uploaded files can be EMBEDDED into the final
   PDF (pdf-lib), which are listed as "provided separately".
   --------------------------------------------------------------------------- */

export type AppendixSource = {
  /** Display name, e.g. "Energy study — Victoria Park.pdf". */
  file_name: string;
  mime_type: string | null;
  /** Storage path in the `documents` bucket. */
  storage_path: string;
  /** Human type label, e.g. "DIALux report", "Technical specification". */
  type_label: string;
  note: string | null;
};

export type AppendixKind = "pdf" | "image" | "external";

export type AppendixItem = AppendixSource & {
  kind: AppendixKind;
  /** "A1", "A2", … for embeddable items; null when provided separately. */
  label: string | null;
};

/** Classify a file by mime (preferred) then extension. */
export function classifyAppendixFile(
  fileName: string,
  mimeType: string | null | undefined
): AppendixKind {
  const mime = (mimeType ?? "").toLowerCase();
  if (mime === "application/pdf") return "pdf";
  if (/^image\/(png|jpe?g)$/.test(mime)) return "image";
  if (mime === "") {
    if (/\.pdf$/i.test(fileName)) return "pdf";
    if (/\.(png|jpe?g)$/i.test(fileName)) return "image";
  }
  // Everything else (zip, docx, xlsx, svg, webp…) can't be embedded reliably.
  return "external";
}

/**
 * Assign appendix order + labels. Embeddable files get sequential "A1…An"
 * labels (order preserved); non-embeddable files keep label null and are
 * listed in the Uploaded Documents index as provided separately.
 */
export function planAppendix(sources: AppendixSource[]): AppendixItem[] {
  let n = 0;
  return sources.map((s) => {
    const kind = classifyAppendixFile(s.file_name, s.mime_type);
    const label = kind === "external" ? null : `A${++n}`;
    return { ...s, kind, label };
  });
}

/**
 * ASCII-fold a string for the pdf-lib separator pages (standard Helvetica
 * only encodes WinAnsi — non-Latin characters would throw at draw time).
 */
export function asciiForSeparator(text: string): string {
  const folded = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/[^\x20-\x7E]/g, "?");
  return folded.trim() || "-";
}

/** Subject + body for the "Send by Email" mailto handoff (no mailer infra). */
export function buildDossierEmail(args: {
  number: string;
  affair: string | null;
  client: string | null;
  fileName: string;
}): { subject: string; body: string } {
  const subject = `Production Dossier ${args.number}${
    args.affair ? ` — ${args.affair}` : ""
  }`;
  const body = [
    "Hello,",
    "",
    `Please find attached the complete production dossier ${args.number}` +
      (args.client ? ` for ${args.client}` : "") +
      (args.affair ? ` (project: ${args.affair})` : "") +
      ".",
    "",
    `Attach the downloaded file: ${args.fileName}`,
    "",
    "Best regards,",
  ].join("\n");
  return { subject, body };
}
