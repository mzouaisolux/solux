/**
 * TERMINOLOGY — centralized fixed translations (m177).
 *
 * The factory-facing vocabulary (section titles, field labels, table headers,
 * status words, standard notices) used to live in two places: 36 terms
 * centralized in lib/production-dossier.ts, and ~90 more typed by hand inline
 * in components/ProductionDossierPDF.tsx. Nothing was machine-translated —
 * but nothing protected the vocabulary either, and the same concept had
 * already drifted on the ENGLISH side:
 *
 *     数量  → "Qty" in three tables, "Quantity" in a fourth
 *     备注  → "Note" in two tables, "Notes" in two others
 *     运输方式 → "Shipping" in the header, "Shipping method" in transport
 *
 * This module is the SINGLE source of truth. Every term has a stable key, and
 * the catalog below is BOTH the built-in default AND the seed for the
 * `terminology` table that the Mapping administration edits. A validated row
 * in the database overrides the default; nothing else ever does.
 *
 * FALLBACK ORDER (owner spec 2026-07-21) — implemented in `resolveTerm`:
 *   1. the validated translation from the database
 *   2. the built-in default for that locale (owner-validated, in code)
 *   3. the English value
 *   4. the key itself (visible, never a blank label on a factory document)
 *
 * There is NO automatic translation anywhere in this system, and this module
 * will never introduce one: an unvalidated term falls back to English rather
 * than being invented. A draft row is treated as absent until a human
 * validates it.
 *
 * Client + server safe (no DB access). The DB rows are loaded by
 * lib/terminology-server.ts and merged through `buildTermDict`.
 */

/** Locales the factory vocabulary is maintained in. English is mandatory. */
export const TERM_LOCALES = ["en", "zh", "fr"] as const;
export type TermLocale = (typeof TERM_LOCALES)[number];

/**
 * Editorial state. Only `validated` is ever rendered — `draft` falls back to
 * English so half-finished Chinese can never reach a factory, and
 * `deprecated` keeps the row for audit without using it.
 */
export const TERM_STATUSES = ["draft", "validated", "deprecated"] as const;
export type TermStatus = (typeof TERM_STATUSES)[number];

/** Grouping in the admin, and the "category" required by the owner spec. */
export const TERM_CATEGORIES = [
  "section",
  "field",
  "table",
  "status",
  "notice",
  "enum",
  "sticker",
  "factory_instruction",
] as const;
export type TermCategory = (typeof TERM_CATEGORIES)[number];

export const TERM_CATEGORY_LABELS: Record<TermCategory, string> = {
  section: "Section headings",
  field: "Field names",
  table: "Table headers",
  status: "Status & standard values",
  notice: "Standard texts & notices",
  enum: "Option labels",
  sticker: "Stickers",
  factory_instruction: "Factory instructions",
};

/** One term as the app renders it. */
export type Term = {
  en: string;
  zh: string;
  fr?: string;
  category: TermCategory;
};

/** One row as the database stores it (and the admin edits it). */
export type TermRow = {
  key: string;
  category: TermCategory;
  en: string;
  zh: string | null;
  fr: string | null;
  status: TermStatus;
  notes: string | null;
  updated_at: string | null;
  updated_by: string | null;
  updated_by_label?: string | null;
};

// ---------------------------------------------------------------------------
// The catalog — built-in defaults AND the m177 seed.
//
// Chinese here is natural manufacturing Chinese as validated by the owner,
// never machine-literal. Keys are stable: renaming one is a migration.
// ---------------------------------------------------------------------------

export const TERM_DEFAULTS = {
  // --- Section headings (were DOSSIER_SECTIONS in lib/production-dossier.ts) --
  "section.dossier": { zh: "生产档案", en: "Production Dossier", category: "section" },
  "section.customer": { zh: "客户信息", en: "Customer Information", category: "section" },
  "section.project": { zh: "项目信息", en: "Project Information", category: "section" },
  "section.order_summary": { zh: "订单摘要", en: "Order Summary", category: "section" },
  "section.production_notes": { zh: "生产说明", en: "Production Notes", category: "section" },
  "section.product_configuration": { zh: "产品配置", en: "Product Configuration", category: "section" },
  "section.factory_mapping": { zh: "工厂映射", en: "Factory Mapping", category: "section" },
  "section.factory_instructions": { zh: "工厂生产说明", en: "Factory Instructions", category: "section" },
  "section.battery": { zh: "电池信息", en: "Battery Information", category: "section" },
  "section.battery_type": { zh: "电池类型", en: "Battery Type", category: "section" },
  "section.technical_refs": { zh: "技术参数", en: "Technical References", category: "section" },
  "section.factory_extras": { zh: "工厂附加参数", en: "Additional Factory Parameters", category: "section" },
  "section.lighting_program": { zh: "灯光程序", en: "Lighting Program", category: "section" },
  "section.energy": { zh: "能源配置", en: "Energy Configuration", category: "section" },
  "section.stickers": { zh: "标签信息", en: "Stickers", category: "section" },
  "section.industrial_file": { zh: "工业生产规格", en: "Industrial Production File", category: "section" },
  "section.tilt_angle": { zh: "太阳能板倾角", en: "Solar Panel Tilt Angle", category: "section" },
  "section.pole_accessories": { zh: "灯杆配件", en: "Pole Accessories", category: "section" },
  "section.packaging": { zh: "包装要求", en: "Packaging", category: "section" },
  "section.user_manual": { zh: "用户手册", en: "User Manual", category: "section" },
  "section.spare_parts": { zh: "备品备件", en: "Spare Parts", category: "section" },
  "section.transport": { zh: "运输信息", en: "Transport Information", category: "section" },
  "section.quality": { zh: "质量控制", en: "Quality Control", category: "section" },
  "section.internal_notes": { zh: "内部备注", en: "Internal Notes", category: "section" },
  "section.uploads": { zh: "上传文件", en: "Uploaded Documents", category: "section" },
  "section.appendix": { zh: "附录", en: "Appendix", category: "section" },
  "section.contents": { zh: "文件目录", en: "Contents", category: "section" },
  "section.dimming_schedule": { zh: "调光程序", en: "Dimming schedule", category: "section" },
  "section.dialux_configs": { zh: "DIALux 生产配置", en: "DIALux production configurations", category: "section" },

  // --- Field names (KV labels) ---------------------------------------------
  "field.client": { zh: "客户", en: "Client", category: "field" },
  "field.country": { zh: "国家", en: "Country", category: "field" },
  "field.contact": { zh: "联系人", en: "Contact", category: "field" },
  "field.order_reference": { zh: "订单编号", en: "Order reference", category: "field" },
  "field.task_list": { zh: "任务单编号", en: "Task list", category: "field" },
  "field.status": { zh: "状态", en: "Status", category: "field" },
  "field.created": { zh: "创建日期", en: "Created", category: "field" },
  "field.created_by": { zh: "创建人", en: "Created by", category: "field" },
  "field.validated_by": { zh: "审核人", en: "Validated by", category: "field" },
  "field.validated_on": { zh: "审核日期", en: "Validated on", category: "field" },
  // Canonical: the header block used "Shipping" and the transport section
  // "Shipping method" for the SAME Chinese term. One key, one English word.
  "field.shipping_method": { zh: "运输方式", en: "Shipping method", category: "field" },
  "field.generated": { zh: "生成日期", en: "Generated", category: "field" },
  "field.original_sales_request": { zh: "客户原始需求", en: "Original sales request", category: "field" },
  "field.production_notes_sales": { zh: "销售生产说明", en: "Production notes (from sales)", category: "field" },
  "field.manual_specs": { zh: "产品规格（非标准件）", en: "Specifications (manual item)", category: "field" },
  "field.line_notes": { zh: "产线备注", en: "Line notes", category: "field" },
  "field.accessory_notes": { zh: "配件备注", en: "Accessory notes", category: "field" },
  "field.packaging_version": { zh: "包装版本", en: "Packaging version", category: "field" },
  "field.packaging_notes": { zh: "包装备注", en: "Packaging notes", category: "field" },
  "field.manual_version": { zh: "手册版本", en: "Manual version", category: "field" },
  "field.languages": { zh: "语言", en: "Languages", category: "field" },
  "field.manual_notes": { zh: "手册备注", en: "Manual notes", category: "field" },
  "field.lighting_power": { zh: "额定功率", en: "Lighting power", category: "field" },
  "field.operating_hours": { zh: "每晚工作时长", en: "Operating hours / night", category: "field" },
  "field.approved_optics": { zh: "配光透镜", en: "Approved optics", category: "field" },
  "field.energy_study": { zh: "能耗报告", en: "Energy study", category: "field" },
  "field.dialux_report": { zh: "DIALux 报告", en: "DIALux report", category: "field" },
  "field.sticker_notes": { zh: "标签总备注", en: "Sticker notes", category: "field" },
  "field.incoterm": { zh: "贸易条款", en: "Incoterm", category: "field" },
  "field.freight_type": { zh: "货运类型", en: "Freight type", category: "field" },
  "field.port_of_loading": { zh: "装运港", en: "Port of loading", category: "field" },
  "field.port_of_destination": { zh: "目的港", en: "Port of destination", category: "field" },
  "field.production_time": { zh: "生产周期", en: "Production time", category: "field" },
  "field.quality_risk_notes": { zh: "质量与风险备注", en: "Quality & risk notes", category: "field" },
  "field.technical_notes_internal": { zh: "内部技术备注", en: "Technical notes (internal)", category: "field" },
  "field.battery_type": { zh: "电池类型", en: "Battery Type", category: "field" },
  "field.factory_code": { zh: "工厂代码", en: "Factory code", category: "field" },
  "field.customer_naming": { zh: "客户命名", en: "Customer", category: "field" },

  // --- Table headers --------------------------------------------------------
  // Canonical: 数量 was "Qty" three times and "Quantity" once; 备注 was
  // "Note" twice and "Notes" twice. One key each.
  "table.qty": { zh: "数量", en: "Qty", category: "table" },
  "table.note": { zh: "备注", en: "Notes", category: "table" },
  "table.field": { zh: "配置项", en: "Field", category: "table" },
  "table.value": { zh: "参数值", en: "Value", category: "table" },
  "table.product": { zh: "产品", en: "Product", category: "table" },
  "table.category": { zh: "系列", en: "Category", category: "table" },
  "table.main_configuration": { zh: "主要配置", en: "Main configuration", category: "table" },
  "table.accessory": { zh: "配件", en: "Accessory", category: "table" },
  "table.included": { zh: "是否包含", en: "Included", category: "table" },
  "table.part": { zh: "部件", en: "Part", category: "table" },
  "table.model": { zh: "型号", en: "Model", category: "table" },
  "table.factory_name": { zh: "工厂命名", en: "Factory name", category: "table" },
  "table.period": { zh: "时段", en: "Period", category: "table" },
  "table.output": { zh: "输出", en: "Output", category: "table" },
  "table.duration": { zh: "时长", en: "Duration", category: "table" },
  "table.motion_sensor": { zh: "感应模式", en: "Motion sensor", category: "table" },
  "table.zone": { zh: "区域", en: "Zone", category: "table" },
  "table.power_w": { zh: "功率", en: "W", category: "table" },
  "table.mounting_height": { zh: "安装高度", en: "H (m)", category: "table" },
  "table.optic": { zh: "光学", en: "Optic", category: "table" },
  "table.cct": { zh: "色温", en: "CCT", category: "table" },
  "table.sticker_item": { zh: "标签", en: "Item", category: "table" },
  "table.method": { zh: "工艺", en: "Method", category: "table" },
  "table.branding": { zh: "品牌", en: "Branding", category: "table" },
  "table.position": { zh: "位置", en: "Position", category: "table" },
  "table.ref": { zh: "编号", en: "Ref", category: "table" },
  "table.file": { zh: "文件", en: "File", category: "table" },
  "table.type": { zh: "类型", en: "Type", category: "table" },
  "table.status": { zh: "状态", en: "Status", category: "table" },

  // --- Status & standard values --------------------------------------------
  "status.included": { zh: "包含", en: "Included", category: "status" },
  "status.excluded": { zh: "不包含", en: "EXCLUDED", category: "status" },
  "status.laser": { zh: "激光", en: "Laser", category: "status" },
  "status.sticker": { zh: "贴纸", en: "Sticker", category: "status" },
  "status.branding_customer": { zh: "客户", en: "Customer", category: "status" },
  "status.fixed_level": { zh: "固定输出", en: "Fixed level", category: "status" },
  "status.in_appendix": { zh: "已合并至附录", en: "Included in appendix", category: "status" },
  "status.provided_separately": { zh: "另行提供", en: "Provided separately", category: "status" },
  "status.motion_boost": { zh: "感应加亮至", en: "boost to", category: "status" },

  // --- Standard texts & notices --------------------------------------------
  "notice.complete_package": { zh: "工厂完整生产文件", en: "Complete production package", category: "notice" },
  "notice.manual_item_no_catalog": {
    zh: "非标准产品 — 无目录配置",
    en: "Manual item — no catalog configuration.",
    category: "notice",
  },
  "notice.no_sales_fields": {
    zh: "无销售配置记录",
    en: "No sales fields recorded for this line.",
    category: "notice",
  },
  "notice.no_factory_mapped_fields": {
    zh: "无需工厂映射",
    en: "No factory-mapped fields on this line.",
    category: "notice",
  },
  "notice.missing_factory_mapping": {
    zh: "缺少工厂映射",
    en: "Missing factory mapping — resolve in Admin → Factory mapping or set a line override.",
    category: "notice",
  },
  "notice.tilt_checked": {
    zh: "灯杆图纸倾角已核对",
    en: "Pole drawing checked against the required tilt angle",
    category: "notice",
  },
  "notice.tilt_not_checked": {
    zh: "灯杆图纸倾角未核对",
    en: "Pole drawing NOT yet checked against the required tilt angle — confirm before production.",
    category: "notice",
  },
  "notice.packaging_artwork_appendix": {
    zh: "客户包装图稿见附录",
    en: "Customer packaging artwork, if uploaded, is included in the Appendix.",
    category: "notice",
  },
  "notice.manual_artwork_appendix": {
    zh: "客户手册图稿见附录",
    en: "Customer manual artwork, if uploaded, is included in the Appendix.",
    category: "notice",
  },
  "notice.no_stickers": { zh: "无标签要求", en: "No sticker requirements.", category: "notice" },
  "notice.sticker_artwork_appendix": {
    zh: "标签图稿见附录",
    en: "Sticker artwork files, if uploaded, are included in the Appendix.",
    category: "notice",
  },
  "notice.no_uploads": {
    zh: "本项目无上传文件",
    en: "No documents uploaded for this project.",
    category: "notice",
  },
  // The appendix preamble used to be one paragraph with the two languages
  // interleaved mid-sentence; split cleanly so each locale is editable.
  "notice.appendix_preamble": {
    zh: "以下附录页为项目上传文件的完整内容，按编号顺序排列（A1、A2…）。本档案为工厂唯一生产依据。",
    en: "The following appendix pages contain the uploaded project documents in full, in reference order (A1, A2…). This dossier is the complete production package.",
    category: "notice",
  },

  // --- Option labels (enum values printed on the dossier) -------------------
  // Mirror lib/industrial-spec.ts enums; the KEY suffix is the enum value.
  "enum.packaging.neutral": { zh: "中性包装（无标识）", en: "Neutral version (no logo)", category: "enum" },
  "enum.packaging.solux_standard": { zh: "SOLUX 标准包装", en: "Standard SOLUX version", category: "enum" },
  "enum.packaging.french_branch": { zh: "法国分公司专用包装", en: "French Branch Exclusive version", category: "enum" },
  "enum.packaging.custom_client": {
    zh: "客户定制包装（需客户标识及设计文件）",
    en: "Customized Client version (customer logo + design files)",
    category: "enum",
  },
  "enum.manual_brand.solux": { zh: "SOLUX 品牌手册", en: "SOLUX branded manual", category: "enum" },
  "enum.manual_brand.neutral": { zh: "中性手册（无品牌）", en: "Neutral manual (no brand)", category: "enum" },
  "enum.manual_brand.custom": {
    zh: "客户定制手册（客户提供图稿）",
    en: "Customized customer manual (customer artwork)",
    category: "enum",
  },
  "enum.manual_language.en": { zh: "英文", en: "English", category: "enum" },
  "enum.manual_language.fr": { zh: "法文", en: "French", category: "enum" },
  "enum.manual_language.ar": { zh: "阿拉伯文", en: "Arabic", category: "enum" },

  // --- Factory instructions -------------------------------------------------
  "factory_instruction.final": {
    zh: "最终生产指令",
    en: "Final factory instruction",
    category: "factory_instruction",
  },
  "factory_instruction.standard_overridden": {
    zh: "标准映射（已被覆盖）",
    en: "Standard mapping (replaced by override)",
    category: "factory_instruction",
  },
} as const satisfies Record<string, Term>;

export type TermKey = keyof typeof TERM_DEFAULTS;

/** Every catalogued key — the admin lists these even before a row exists. */
export const TERM_KEYS = Object.keys(TERM_DEFAULTS) as TermKey[];

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/** A resolved dictionary: key → the term to render. */
export type TermDict = Record<string, Term>;

function cleanStr(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function cleanCategory(v: unknown): TermCategory | null {
  return typeof v === "string" && (TERM_CATEGORIES as readonly string[]).includes(v)
    ? (v as TermCategory)
    : null;
}

function cleanStatus(v: unknown): TermStatus {
  return typeof v === "string" && (TERM_STATUSES as readonly string[]).includes(v)
    ? (v as TermStatus)
    : "draft"; // unknown state is treated as unvalidated — fail safe
}

/** Normalize one stored row. Returns null when there is no usable key. */
export function normalizeTermRow(raw: unknown): TermRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const key = cleanStr(r.key);
  if (!key) return null;
  const builtin = (TERM_DEFAULTS as Record<string, Term>)[key];
  return {
    key,
    category: cleanCategory(r.category) ?? builtin?.category ?? "field",
    // English is mandatory: fall back to the built-in, then to the key, so a
    // row can never render as an empty label.
    en: cleanStr(r.en) ?? builtin?.en ?? key,
    zh: cleanStr(r.zh),
    fr: cleanStr(r.fr),
    status: cleanStatus(r.status),
    notes: cleanStr(r.notes),
    updated_at: cleanStr(r.updated_at),
    updated_by: cleanStr(r.updated_by),
    updated_by_label: cleanStr(r.updated_by_label),
  };
}

/**
 * Merge the database rows over the built-in catalog.
 *
 * A row only contributes a translation when it is VALIDATED — a draft or
 * deprecated row leaves the built-in default in place, so editing in the admin
 * cannot degrade a factory document until someone marks the work validated.
 * Rows for keys that are not in the catalog are kept (the admin can add new
 * terms without a code deploy).
 */
export function buildTermDict(rows: readonly TermRow[] | null | undefined): TermDict {
  const dict: TermDict = { ...(TERM_DEFAULTS as unknown as TermDict) };
  for (const row of rows ?? []) {
    if (row.status !== "validated") continue;
    const builtin = (TERM_DEFAULTS as Record<string, Term>)[row.key];
    dict[row.key] = {
      en: row.en || builtin?.en || row.key,
      // A validated row with an empty Chinese still falls back to the built-in
      // (and then to English in resolveTerm) — never to a blank.
      zh: row.zh ?? builtin?.zh ?? "",
      fr: row.fr ?? builtin?.fr,
      category: row.category ?? builtin?.category ?? "field",
    };
  }
  return dict;
}

/**
 * Resolve one term for one locale, applying the owner's fallback order:
 * validated translation → built-in default → English → the key itself.
 * Never returns an empty string, and never invents a translation.
 */
export function resolveTerm(dict: TermDict, key: string, locale: TermLocale = "en"): string {
  const term = dict[key] ?? (TERM_DEFAULTS as Record<string, Term>)[key];
  if (!term) return key; // unknown key stays visible rather than rendering blank
  if (locale === "en") return term.en || key;
  const v = locale === "zh" ? term.zh : term.fr;
  return (v && v.trim() !== "" ? v : term.en) || key;
}

/** A bilingual pair for the factory documents (Chinese over English). */
export type BiTerm = { zh: string; en: string };

/** Resolve a term as the zh/en pair the dossier renders. */
export function bi(dict: TermDict, key: string): BiTerm {
  return { zh: resolveTerm(dict, key, "zh"), en: resolveTerm(dict, key, "en") };
}

/**
 * The render-time helper the factory documents use. Bind the dictionary once
 * per render, then resolve many terms.
 *
 *   T.zh(k) / T.en(k)  — one locale (the stacked Chinese-over-English rows)
 *   T.bi(k) / T.kv(k)  — the {zh, en} pair a section title or KV cell takes
 *   T.dot(k)           — the "中文 · English" single-line form used in tables
 */
export type Terms = {
  t: (key: string, locale?: TermLocale) => string;
  zh: (key: string) => string;
  en: (key: string) => string;
  bi: (key: string) => BiTerm;
  kv: (key: string) => BiTerm;
  dot: (key: string) => string;
};

export function makeTerms(dict: TermDict): Terms {
  const zh = (key: string) => resolveTerm(dict, key, "zh");
  const en = (key: string) => resolveTerm(dict, key, "en");
  return {
    t: (key, locale: TermLocale = "en") => resolveTerm(dict, key, locale),
    zh,
    en,
    bi: (key) => bi(dict, key),
    kv: (key) => bi(dict, key),
    // When a term has no distinct Chinese (fallback to English), the "·" join
    // would print the same words twice — collapse it to one.
    dot: (key) => {
      const z = zh(key);
      const e = en(key);
      return z === e ? e : `${z} · ${e}`;
    },
  };
}

/** The built-in dictionary — used pre-migration and as the test baseline. */
export const DEFAULT_TERM_DICT: TermDict = TERM_DEFAULTS as unknown as TermDict;
