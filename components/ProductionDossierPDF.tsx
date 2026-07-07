"use client";

import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type {
  ExportData,
  ExportLine,
} from "@/app/(app)/task-lists/[id]/exportData";
import {
  BATTERY_CELL_KEY,
  DOSSIER_SECTIONS,
  isBatteryLabel,
  type AppendixItem,
  type BiTitle,
} from "@/lib/production-dossier";
import {
  BrandHeader,
  Rule,
  COLORS,
  F,
  M_OUT,
  GAP_S,
  GAP_M,
} from "@/components/pdf/theme";

/**
 * Production Dossier PDF — the COMPLETE production package generated from a
 * validated task list. Replaces the old partial "Factory Task List" export.
 *
 * Design brief (owner spec):
 *   - Engineering dossier, not a simple export: numbered sections, page
 *     breaks between major sections, running header with project info,
 *     page numbers, readable tables.
 *   - Every validated section is included: customer, project, product
 *     configuration, factory mapping/instructions (3-tier resolution),
 *     battery (incl. cell type), lighting program periods, energy config,
 *     transport, stickers, QA/risks, internal notes, uploaded documents.
 *   - Bilingual section titles: Simplified Chinese FIRST, English under —
 *     the primary reader is the factory team in China.
 *   - The appendix (uploaded documents merged into this PDF via pdf-lib)
 *     is indexed here; the actual pages are appended post-render.
 *
 * CJK: @react-pdf has NO per-glyph font fallback — every Text that can carry
 * Chinese or user-entered text is EXPLICITLY set to the Noto Sans SC family
 * (F.cjk), same approach as the proven FactoryPDF CJK fix.
 */

const s = StyleSheet.create({
  page: {
    paddingTop: M_OUT,
    paddingBottom: M_OUT + 20,
    paddingHorizontal: M_OUT,
    fontFamily: F.body,
    fontWeight: 200,
    fontSize: 8,
    color: COLORS.body,
    lineHeight: 1.45,
  },
  contentPage: {
    paddingTop: M_OUT + 16, // room for the fixed running header
  },

  /* ----- Running header (content pages) ----- */
  runHead: {
    position: "absolute",
    top: 12,
    left: M_OUT,
    right: M_OUT,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.hair,
    paddingBottom: 4,
  },
  runHeadLeft: {
    fontFamily: F.cjk,
    fontSize: 7.5,
    fontWeight: 400,
    color: COLORS.ink,
    letterSpacing: 0.4,
  },
  runHeadRight: {
    fontFamily: F.cjk,
    fontSize: 7.5,
    fontWeight: 400,
    color: COLORS.muted,
    maxWidth: "55%",
    textAlign: "right",
  },

  /* ----- Footer ----- */
  footer: {
    position: "absolute",
    bottom: 16,
    left: M_OUT,
    right: M_OUT,
    fontFamily: F.cjk,
    fontSize: 7,
    fontWeight: 400,
    color: COLORS.muted,
    textAlign: "center",
    letterSpacing: 0.6,
    borderTopWidth: 0.5,
    borderTopColor: COLORS.hair,
    paddingTop: 5,
  },

  /* ----- Cover ----- */
  coverTitleZh: {
    fontFamily: F.cjk,
    fontSize: 22,
    fontWeight: 400,
    color: COLORS.ink,
    textAlign: "center",
    letterSpacing: 6,
  },
  coverTitleEn: {
    fontFamily: F.title,
    fontWeight: 300,
    fontSize: 13,
    letterSpacing: 2.5,
    color: COLORS.ink,
    textTransform: "uppercase",
    textAlign: "center",
    marginTop: 4,
  },
  coverNumber: {
    fontFamily: F.body,
    fontWeight: 900,
    fontSize: 13,
    color: COLORS.ink,
    textAlign: "center",
    marginTop: 6,
    letterSpacing: 0.6,
  },
  coverCaption: {
    // F.cjk — the caption mixes Latin + Chinese; @react-pdf has no per-glyph
    // fallback, a Latin face here renders the Chinese as mojibake.
    fontFamily: F.cjk,
    fontSize: 7.5,
    fontWeight: 400,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: COLORS.muted,
    textAlign: "center",
    marginTop: 4,
  },
  coverProjectBox: {
    marginTop: GAP_M,
    borderWidth: 0.5,
    borderColor: COLORS.ink,
    padding: 12,
  },
  coverProjectLabel: {
    fontFamily: F.cjk,
    fontSize: 7.5,
    fontWeight: 400,
    color: COLORS.muted,
    letterSpacing: 1,
    marginBottom: 2,
  },
  coverProjectName: {
    fontFamily: F.cjk,
    fontSize: 16,
    fontWeight: 600,
    color: COLORS.ink,
  },

  /* ----- Bilingual section header ----- */
  secWrap: { marginBottom: GAP_S },
  secZh: {
    fontFamily: F.cjk,
    fontSize: 12.5,
    fontWeight: 600,
    color: COLORS.ink,
    letterSpacing: 1.5,
  },
  secEn: {
    fontFamily: F.title,
    fontWeight: 300,
    fontSize: 8.5,
    color: COLORS.muted,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    marginTop: 2,
  },
  secRule: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.ink,
    marginTop: 5,
  },

  /* ----- Bilingual sub-header (inside a section) ----- */
  subWrap: {
    flexDirection: "row",
    alignItems: "baseline",
    marginTop: GAP_S,
    marginBottom: 5,
  },
  subZh: {
    fontFamily: F.cjk,
    fontSize: 9.5,
    fontWeight: 600,
    color: COLORS.ink,
    letterSpacing: 0.8,
  },
  subEn: {
    fontSize: 7,
    fontWeight: 400,
    color: COLORS.muted,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginLeft: 8,
  },

  /* ----- Key/value grid ----- */
  kvGrid: { flexDirection: "row", flexWrap: "wrap" },
  kvCell: { width: "33.33%", marginBottom: 8, paddingRight: 10 },
  kvCellWide: { width: "66.66%", marginBottom: 8, paddingRight: 10 },
  kvLabelZh: {
    fontFamily: F.cjk,
    fontSize: 7,
    fontWeight: 400,
    color: COLORS.muted,
    letterSpacing: 0.6,
  },
  kvLabelEn: {
    fontSize: 6.5,
    fontWeight: 400,
    color: COLORS.muted,
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  kvValue: {
    fontFamily: F.cjk,
    fontSize: 9,
    fontWeight: 400,
    color: COLORS.ink,
    marginTop: 1.5,
  },

  /* ----- Tables ----- */
  table: { marginTop: 2 },
  tHead: {
    flexDirection: "row",
    backgroundColor: COLORS.hair,
    paddingVertical: 5,
    paddingHorizontal: 6,
  },
  tHeadCell: {
    fontFamily: F.cjk,
    fontSize: 7.5,
    fontWeight: 600,
    color: COLORS.ink,
    letterSpacing: 0.2,
  },
  tRow: {
    flexDirection: "row",
    paddingVertical: 4.5,
    paddingHorizontal: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.hair,
  },
  tRowAlt: { backgroundColor: COLORS.fill },
  tCell: {
    fontFamily: F.cjk,
    fontSize: 8,
    fontWeight: 200,
    color: COLORS.body,
  },
  tCellStrong: {
    fontFamily: F.cjk,
    fontSize: 8.5,
    fontWeight: 600,
    color: COLORS.ink,
  },

  /* ----- Notes blocks ----- */
  notesBlock: {
    borderWidth: 0.5,
    borderColor: COLORS.hair,
    padding: 8,
    marginBottom: 8,
  },
  notesBlockWarn: {
    borderWidth: 0.5,
    borderColor: COLORS.warnBorder,
    backgroundColor: COLORS.warnBg,
    padding: 8,
    marginBottom: 8,
  },
  notesLabelRow: { flexDirection: "row", alignItems: "baseline", marginBottom: 3 },
  notesLabelZh: {
    fontFamily: F.cjk,
    fontSize: 7.5,
    fontWeight: 600,
    color: COLORS.muted,
    letterSpacing: 0.6,
  },
  notesLabelEn: {
    fontSize: 6.5,
    fontWeight: 400,
    color: COLORS.muted,
    textTransform: "uppercase",
    letterSpacing: 0.7,
    marginLeft: 6,
  },
  notesText: {
    fontFamily: F.cjk,
    fontSize: 8.5,
    fontWeight: 200,
    color: COLORS.body,
    lineHeight: 1.5,
  },

  /* ----- Product line ----- */
  lineHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    backgroundColor: COLORS.fill,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.ink,
    paddingVertical: 7,
    paddingHorizontal: 8,
    marginBottom: 8,
  },
  lineProductName: {
    fontFamily: F.cjk,
    fontSize: 12,
    fontWeight: 600,
    color: COLORS.ink,
    letterSpacing: 0.3,
  },
  lineMeta: {
    fontFamily: F.cjk,
    fontSize: 7.5,
    fontWeight: 200,
    color: COLORS.muted,
    marginTop: 1,
  },
  lineQtyLabel: {
    fontFamily: F.cjk,
    fontSize: 7,
    fontWeight: 400,
    color: COLORS.muted,
    letterSpacing: 0.8,
  },
  lineQtyValue: { fontSize: 13, fontWeight: 900, color: COLORS.ink },

  /* ----- Instruction cards ----- */
  fieldCard: {
    borderWidth: 0.5,
    borderColor: COLORS.hair,
    padding: 8,
    marginBottom: 6,
  },
  fieldCardOverride: {
    borderColor: COLORS.warnBorder,
    backgroundColor: COLORS.warnBg,
  },
  fieldCardMissing: {
    borderColor: COLORS.dangerBorder,
    backgroundColor: COLORS.dangerBg,
  },
  fieldHeader: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    marginBottom: 3,
  },
  fieldName: {
    fontFamily: F.cjk,
    fontSize: 9,
    fontWeight: 600,
    color: COLORS.ink,
    marginRight: 8,
  },
  salesPill: {
    fontFamily: F.cjk,
    fontSize: 8,
    fontWeight: 400,
    color: COLORS.ink,
    backgroundColor: COLORS.fill,
    borderWidth: 0.5,
    borderColor: COLORS.hair,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  badge: {
    fontSize: 6.5,
    fontWeight: 600,
    borderWidth: 0.5,
    paddingHorizontal: 5,
    paddingVertical: 1,
    marginLeft: 6,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  badgeOverride: { color: COLORS.warnText, borderColor: COLORS.warnBorder },
  badgeMissing: { color: COLORS.dangerText, borderColor: COLORS.dangerBorder },
  badgePreset: { color: COLORS.muted, borderColor: COLORS.hair },
  instructionLabelRow: {
    flexDirection: "row",
    alignItems: "baseline",
    marginTop: 3,
    marginBottom: 1,
  },
  instructionText: {
    fontFamily: F.cjk,
    fontSize: 9,
    fontWeight: 200,
    color: COLORS.ink,
    lineHeight: 1.5,
  },
  instructionMuted: {
    fontFamily: F.cjk,
    fontSize: 9,
    fontWeight: 200,
    color: COLORS.dangerText,
    fontStyle: "italic",
    lineHeight: 1.5,
  },
  mappingText: {
    fontFamily: F.cjk,
    fontSize: 8,
    fontWeight: 200,
    color: COLORS.muted,
    fontStyle: "italic",
    lineHeight: 1.45,
  },
  factoryCodeRow: {
    fontFamily: F.cjk,
    fontSize: 8,
    fontWeight: 400,
    color: COLORS.muted,
    marginBottom: 2,
  },

  /* ----- Battery highlight ----- */
  batteryBox: {
    borderWidth: 1,
    borderColor: COLORS.ink,
    padding: 10,
    marginBottom: 8,
  },
  batteryTypeRow: {
    flexDirection: "row",
    alignItems: "baseline",
    marginBottom: 6,
  },
  batteryTypeValue: {
    fontFamily: F.body,
    fontSize: 16,
    fontWeight: 900,
    color: COLORS.ink,
    marginLeft: 10,
    letterSpacing: 1,
  },

  emptyNote: {
    fontFamily: F.cjk,
    fontSize: 8,
    fontWeight: 200,
    color: COLORS.muted,
  },
});

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB");
}

/* --------------------------- bilingual primitives -------------------------- */

function BiSection({
  n,
  title,
  children,
}: {
  n: number;
  title: BiTitle;
  children?: React.ReactNode;
}) {
  return (
    <View style={s.secWrap} wrap={false}>
      <Text style={s.secZh}>
        {n}. {title.zh}
      </Text>
      <Text style={s.secEn}>{title.en}</Text>
      <View style={s.secRule} />
      {children}
    </View>
  );
}

function BiSub({ title }: { title: BiTitle }) {
  return (
    <View style={s.subWrap} wrap={false}>
      <Text style={s.subZh}>{title.zh}</Text>
      <Text style={s.subEn}>{title.en}</Text>
    </View>
  );
}

function KV({
  zh,
  en,
  value,
  wide = false,
}: {
  zh: string;
  en: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <View style={wide ? s.kvCellWide : s.kvCell}>
      <Text style={s.kvLabelZh}>{zh}</Text>
      <Text style={s.kvLabelEn}>{en}</Text>
      <Text style={s.kvValue}>{value || "—"}</Text>
    </View>
  );
}

function NotesBlock({
  zh,
  en,
  text,
  warn = false,
}: {
  zh: string;
  en: string;
  text: string;
  warn?: boolean;
}) {
  return (
    <View style={warn ? s.notesBlockWarn : s.notesBlock} wrap={false}>
      <View style={s.notesLabelRow}>
        <Text style={s.notesLabelZh}>{zh}</Text>
        <Text style={s.notesLabelEn}>{en}</Text>
      </View>
      <Text style={s.notesText}>{text}</Text>
    </View>
  );
}

/* ------------------------------- line blocks ------------------------------- */

function LineConfigTable({ line }: { line: ExportLine }) {
  if (line.rows.length === 0) {
    return (
      <Text style={s.emptyNote}>
        {line.is_manual
          ? "非标准产品 — 无目录配置 · Manual item — no catalog configuration."
          : "无销售配置记录 · No sales fields recorded for this line."}
      </Text>
    );
  }
  return (
    <View style={s.table}>
      <View style={s.tHead} fixed>
        <Text style={[s.tHeadCell, { flex: 2 }]}>配置项 · Field</Text>
        <Text style={[s.tHeadCell, { flex: 3 }]}>参数值 · Value</Text>
      </View>
      {line.rows.map((r, i) => (
        <View
          key={i}
          style={i % 2 === 1 ? [s.tRow, s.tRowAlt] : s.tRow}
          wrap={false}
        >
          <Text style={[s.tCellStrong, { flex: 2, paddingRight: 8 }]}>
            {r.field_name}
          </Text>
          <Text style={[s.tCell, { flex: 3 }]}>{r.sales_value}</Text>
        </View>
      ))}
    </View>
  );
}

function LineInstructionCards({ line }: { line: ExportLine }) {
  // Instruction cards for every row that carries a factory resolution
  // (mapping / preset / override / missing). Plain informational sales
  // fields are already in the configuration table above.
  const rows = line.rows.filter(
    (r) => r.note !== "Sales field — no mapping required"
  );
  if (rows.length === 0) {
    return (
      <Text style={s.emptyNote}>
        无需工厂映射 · No factory-mapped fields on this line.
      </Text>
    );
  }
  return (
    <>
      {rows.map((r, j) => {
        const cardStyle =
          r.source === "override"
            ? [s.fieldCard, s.fieldCardOverride]
            : r.source === "missing"
            ? [s.fieldCard, s.fieldCardMissing]
            : s.fieldCard;
        return (
          <View key={j} style={cardStyle} wrap={false}>
            <View style={s.fieldHeader}>
              <Text style={s.fieldName}>{r.field_name}</Text>
              <Text style={s.salesPill}>{r.sales_value}</Text>
              {r.source === "override" && (
                <Text style={[s.badge, s.badgeOverride]}>Overridden</Text>
              )}
              {r.source === "client_preset" && (
                <Text style={[s.badge, s.badgePreset]}>Client preset</Text>
              )}
              {r.source === "missing" && (
                <Text style={[s.badge, s.badgeMissing]}>Missing</Text>
              )}
            </View>

            {r.factory_code && (
              <Text style={s.factoryCodeRow}>
                工厂代码 · Factory code: {r.factory_code}
              </Text>
            )}

            <View style={s.instructionLabelRow}>
              <Text style={s.notesLabelZh}>最终生产指令</Text>
              <Text style={s.notesLabelEn}>Final factory instruction</Text>
            </View>
            {r.source === "missing" ? (
              <Text style={s.instructionMuted}>
                缺少工厂映射 · Missing factory mapping — resolve in Admin →
                Factory mapping or set a line override.
              </Text>
            ) : (
              <Text style={s.instructionText}>
                {r.final_factory_instruction || "—"}
              </Text>
            )}

            {r.source === "override" && r.factory_mapping_instruction && (
              <>
                <View style={s.instructionLabelRow}>
                  <Text style={s.notesLabelZh}>标准映射（已被覆盖）</Text>
                  <Text style={s.notesLabelEn}>
                    Standard mapping (replaced by override)
                  </Text>
                </View>
                <Text style={s.mappingText}>
                  {r.factory_mapping_instruction}
                </Text>
              </>
            )}
          </View>
        );
      })}
    </>
  );
}

function LineBatteryBlock({ line }: { line: ExportLine }) {
  const batteryRows = line.rows.filter((r) => isBatteryLabel(r.field_name));
  const batteryTech = line.technical_entries.filter(
    (e) => isBatteryLabel(e.label) && e.label !== BATTERY_CELL_KEY
  );
  const batteryExtras = line.factory_extras.filter(
    (e) => isBatteryLabel(e.label) || isBatteryLabel(e.key)
  );
  const hasAny =
    line.battery_cell_type ||
    batteryRows.length > 0 ||
    batteryTech.length > 0 ||
    batteryExtras.length > 0;
  if (!hasAny) return null;

  return (
    <>
      <BiSub title={DOSSIER_SECTIONS.battery} />
      <View style={s.batteryBox} wrap={false}>
        {line.battery_cell_type && (
          <View style={s.batteryTypeRow}>
            <Text style={s.notesLabelZh}>电池类型</Text>
            <Text style={s.notesLabelEn}>Battery Type</Text>
            <Text style={s.batteryTypeValue}>{line.battery_cell_type}</Text>
          </View>
        )}
        {batteryRows.map((r, i) => (
          <View key={`r${i}`} style={{ marginBottom: 4 }}>
            <View style={s.instructionLabelRow}>
              <Text style={s.notesLabelZh}>{r.field_name}</Text>
              <Text style={s.notesLabelEn}>{r.sales_value}</Text>
            </View>
            {r.final_factory_instruction &&
              r.final_factory_instruction !== r.sales_value && (
                <Text style={s.instructionText}>
                  {r.final_factory_instruction}
                </Text>
              )}
          </View>
        ))}
        {[...batteryTech, ...batteryExtras.map((e) => ({ label: e.label, value: e.value }))].map(
          (e, i) => (
            <View key={`t${i}`} style={{ marginBottom: 3 }}>
              <Text style={s.kvLabelZh}>{e.label}</Text>
              <Text style={s.kvValue}>{e.value}</Text>
            </View>
          )
        )}
      </View>
    </>
  );
}

/* --------------------------------- document -------------------------------- */

export default function ProductionDossierPDF({
  data,
  appendix,
}: {
  data: ExportData;
  /** Planned appendix (labels assigned) — pages merged post-render by pdf-lib. */
  appendix: AppendixItem[];
}) {
  const S = DOSSIER_SECTIONS;
  const generatedAt = fmtDate(new Date().toISOString());

  // Dynamic section numbering — sections only count when they render.
  const showNotes = !!(
    data.production_notes || data.original_sales_request
  );
  const showLighting = !!(
    data.lighting &&
    (data.lighting.lighting_power ||
      data.lighting.operating_hours ||
      data.lighting.lighting_program.length > 0 ||
      data.lighting.approved_optics ||
      data.lighting.dialux_configurations.length > 0)
  );
  const requiredStickers = data.stickers?.items.filter((i) => i.required) ?? [];
  const showStickers = requiredStickers.length > 0 || !!data.stickers?.notes;
  const showTransport = !!(data.logistics || data.shipping_method);
  const activeRisks = data.risks?.items.filter((i) => i.active) ?? [];
  const showQuality = activeRisks.length > 0 || !!data.risks?.notes;
  const showInternal = !!data.technical_notes;

  let n = 0;
  const num = () => ++n;
  const nSummary = num();
  const nNotes = showNotes ? num() : 0;
  const lineNumbers = data.lines.map(() => num());
  const nLighting = showLighting ? num() : 0;
  const nStickers = showStickers ? num() : 0;
  const nTransport = showTransport ? num() : 0;
  const nQuality = showQuality ? num() : 0;
  const nInternal = showInternal ? num() : 0;
  const nUploads = num();

  const runningTitle = `${S.dossier.zh} Production Dossier · ${data.number}`;
  const runningRight = [data.affair_name, data.client.company_name]
    .filter(Boolean)
    .join(" · ");

  // No "Page X of Y" here: the appendix (merged post-render by pdf-lib)
  // would make any @react-pdf total wrong. Global page numbers covering the
  // WHOLE package are stamped by mergeDossierWithAppendix on every page.
  const footer = (
    <Text style={s.footer} fixed>
      {`SOLUX · ${S.dossier.zh} Production Dossier · ${data.number} · ${generatedAt}`}
    </Text>
  );

  return (
    <Document>
      {/* ================= COVER — customer + project identity ================= */}
      <Page size="A4" style={s.page} wrap>
        <BrandHeader />

        <View style={{ marginTop: GAP_M }}>
          <Text style={s.coverTitleZh}>{S.dossier.zh}</Text>
          <Text style={s.coverTitleEn}>{S.dossier.en}</Text>
          <Text style={s.coverNumber}>{data.number}</Text>
          <Text style={s.coverCaption}>
            Complete production package · 工厂完整生产文件
          </Text>
        </View>

        {data.affair_name ? (
          <View style={s.coverProjectBox} wrap={false}>
            <Text style={s.coverProjectLabel}>
              {S.project.zh} · {S.project.en}
            </Text>
            <Text style={s.coverProjectName}>{data.affair_name}</Text>
          </View>
        ) : null}

        <View style={{ marginTop: GAP_M }}>
          <BiSub title={S.customer} />
          <View style={s.kvGrid}>
            <KV
              zh="客户"
              en="Client"
              value={
                data.client.company_name +
                (data.client.client_code ? ` · ${data.client.client_code}` : "")
              }
            />
            <KV zh="国家" en="Country" value={data.client.country ?? "—"} />
            <KV zh="联系人" en="Contact" value={data.client.contact_name ?? "—"} />
          </View>
        </View>

        <Rule />

        <View>
          <BiSub title={S.project} />
          <View style={s.kvGrid}>
            <KV
              zh="订单编号"
              en="Order reference"
              value={data.quotation_number ?? "—"}
            />
            <KV zh="任务单编号" en="Task list" value={data.number} />
            <KV
              zh="状态"
              en="Status"
              value={data.status.replace(/_/g, " ").toUpperCase()}
            />
            <KV zh="创建日期" en="Created" value={fmtDate(data.created_at)} />
            <KV zh="创建人" en="Created by" value={data.created_by_label} />
            <KV
              zh="审核人"
              en="Validated by"
              value={data.validated_by_label}
            />
            <KV
              zh="审核日期"
              en="Validated on"
              value={fmtDate(data.validated_at)}
            />
            <KV
              zh="运输方式"
              en="Shipping"
              value={data.shipping_method ?? "—"}
            />
            <KV zh="生成日期" en="Generated" value={generatedAt} />
          </View>
        </View>

        <Rule />

        {/* Document map — what this dossier contains (no page numbers:
            sections are numbered, the reader follows the running order). */}
        <View>
          <BiSub title={{ zh: "文件目录", en: "Contents" }} />
          {[
            `${nSummary}. ${S.order_summary.zh} · ${S.order_summary.en}`,
            ...(showNotes
              ? [`${nNotes}. ${S.production_notes.zh} · ${S.production_notes.en}`]
              : []),
            ...data.lines.map(
              (l, i) =>
                `${lineNumbers[i]}. ${S.product_configuration.zh} · ${S.product_configuration.en} — ${l.product_name}`
            ),
            ...(showLighting
              ? [`${nLighting}. ${S.lighting_program.zh} · ${S.lighting_program.en}`]
              : []),
            ...(showStickers
              ? [`${nStickers}. ${S.stickers.zh} · ${S.stickers.en}`]
              : []),
            ...(showTransport
              ? [`${nTransport}. ${S.transport.zh} · ${S.transport.en}`]
              : []),
            ...(showQuality
              ? [`${nQuality}. ${S.quality.zh} · ${S.quality.en}`]
              : []),
            ...(showInternal
              ? [`${nInternal}. ${S.internal_notes.zh} · ${S.internal_notes.en}`]
              : []),
            `${nUploads}. ${S.uploads.zh} · ${S.uploads.en} + ${S.appendix.zh} · ${S.appendix.en}`,
          ].map((row, i) => (
            <Text
              key={i}
              style={[s.tCell, { marginBottom: 2.5, fontSize: 8.5 }]}
            >
              {row}
            </Text>
          ))}
        </View>

        {footer}
      </Page>

      {/* ================= CONTENT ================= */}
      <Page size="A4" style={[s.page, s.contentPage]} wrap>
        <View style={s.runHead} fixed>
          <Text style={s.runHeadLeft}>{runningTitle}</Text>
          <Text style={s.runHeadRight}>{runningRight}</Text>
        </View>

        {/* ---------- ORDER SUMMARY ---------- */}
        <BiSection n={nSummary} title={S.order_summary} />
        <View style={s.table}>
          <View style={s.tHead} fixed>
            <Text style={[s.tHeadCell, { flex: 3 }]}>产品 · Product</Text>
            <Text style={[s.tHeadCell, { flex: 2 }]}>系列 · Category</Text>
            <Text style={[s.tHeadCell, { width: 44, textAlign: "right" }]}>
              数量 · Qty
            </Text>
            <Text style={[s.tHeadCell, { flex: 4, paddingLeft: 8 }]}>
              主要配置 · Main configuration
            </Text>
          </View>
          {data.lines.length === 0 ? (
            <View style={s.tRow}>
              <Text style={s.emptyNote}>No line items.</Text>
            </View>
          ) : (
            data.lines.map((l, i) => (
              <View
                key={i}
                style={i % 2 === 1 ? [s.tRow, s.tRowAlt] : s.tRow}
                wrap={false}
              >
                <View style={{ flex: 3, paddingRight: 8 }}>
                  <Text style={s.tCellStrong}>{l.product_name}</Text>
                  {l.product_sku && (
                    <Text style={[s.tCell, { fontSize: 7.5, color: COLORS.muted }]}>
                      {l.product_sku}
                    </Text>
                  )}
                </View>
                <Text style={[s.tCell, { flex: 2, paddingRight: 8 }]}>
                  {l.product_category ?? "—"}
                </Text>
                <Text
                  style={[
                    s.tCellStrong,
                    { width: 44, textAlign: "right" },
                  ]}
                >
                  × {l.quantity}
                </Text>
                <Text style={[s.tCell, { flex: 4, paddingLeft: 8 }]}>
                  {l.config_summary || "—"}
                </Text>
              </View>
            ))
          )}
        </View>

        {/* ---------- PRODUCTION NOTES ---------- */}
        {showNotes && (
          <View break>
            <BiSection n={nNotes} title={S.production_notes} />
            {data.original_sales_request && (
              <NotesBlock
                zh="客户原始需求"
                en="Original sales request"
                text={data.original_sales_request}
              />
            )}
            {data.production_notes && (
              <NotesBlock
                zh="销售生产说明"
                en="Production notes (from sales)"
                text={data.production_notes}
              />
            )}
          </View>
        )}

        {/* ---------- PER-PRODUCT SECTIONS ---------- */}
        {data.lines.map((l, i) => (
          <View key={i} break>
            <BiSection
              n={lineNumbers[i]}
              title={{
                zh: `${S.product_configuration.zh}（${i + 1}/${data.lines.length}）`,
                en: `${S.product_configuration.en} (${i + 1} of ${data.lines.length})`,
              }}
            />
            <View style={s.lineHeader} minPresenceAhead={80}>
              <View style={{ flex: 1, paddingRight: 8 }}>
                <Text style={s.lineProductName}>{l.product_name}</Text>
                <Text style={s.lineMeta}>
                  {l.product_sku ?? "—"}
                  {l.product_category ? ` · ${l.product_category}` : ""}
                </Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={s.lineQtyLabel}>数量 · Quantity</Text>
                <Text style={s.lineQtyValue}>× {l.quantity}</Text>
              </View>
            </View>

            {l.is_manual && l.manual_specs && (
              <NotesBlock
                zh="产品规格（非标准件）"
                en="Specifications (manual item)"
                text={l.manual_specs}
              />
            )}

            <LineConfigTable line={l} />

            <BiSub
              title={{
                zh: `${S.factory_mapping.zh} · ${S.factory_instructions.zh}`,
                en: `${S.factory_mapping.en} · ${S.factory_instructions.en}`,
              }}
            />
            <LineInstructionCards line={l} />

            <LineBatteryBlock line={l} />

            {l.technical_entries.filter(
              (e) => !isBatteryLabel(e.label)
            ).length > 0 && (
              <>
                <BiSub title={S.technical_refs} />
                <View style={[s.kvGrid, s.notesBlock]} wrap={false}>
                  {l.technical_entries
                    .filter((e) => !isBatteryLabel(e.label))
                    .map((e, j) => (
                      <View key={j} style={{ width: "50%", marginBottom: 4 }}>
                        <Text style={s.kvLabelZh}>{e.label}</Text>
                        <Text style={s.kvValue}>{e.value}</Text>
                      </View>
                    ))}
                </View>
              </>
            )}

            {l.factory_extras.filter(
              (e) => !isBatteryLabel(e.label) && !isBatteryLabel(e.key)
            ).length > 0 && (
              <>
                <BiSub title={S.factory_extras} />
                <View style={[s.kvGrid, s.notesBlock]} wrap={false}>
                  {l.factory_extras
                    .filter(
                      (e) => !isBatteryLabel(e.label) && !isBatteryLabel(e.key)
                    )
                    .map((e, j) => (
                      <View key={j} style={{ width: "50%", marginBottom: 4 }}>
                        <Text style={s.kvLabelZh}>{e.label}</Text>
                        <Text style={s.kvValue}>{e.value}</Text>
                      </View>
                    ))}
                </View>
              </>
            )}

            {l.internal_notes && (
              <NotesBlock
                zh="产线备注"
                en="Line notes"
                text={l.internal_notes}
              />
            )}
          </View>
        ))}

        {/* ---------- LIGHTING PROGRAM + ENERGY ---------- */}
        {showLighting && data.lighting && (
          <View break>
            <BiSection n={nLighting} title={S.lighting_program} />

            <BiSub title={S.energy} />
            <View style={s.kvGrid}>
              <KV
                zh="额定功率"
                en="Lighting power"
                value={
                  data.lighting.lighting_power != null
                    ? `${data.lighting.lighting_power} W`
                    : "—"
                }
              />
              <KV
                zh="每晚工作时长"
                en="Operating hours / night"
                value={
                  data.lighting.operating_hours != null
                    ? `${data.lighting.operating_hours} h`
                    : "—"
                }
              />
              <KV
                zh="配光透镜"
                en="Approved optics"
                value={data.lighting.approved_optics ?? "—"}
              />
              <KV
                zh="能耗报告"
                en="Energy study"
                value={data.lighting.energy_study_name ?? "—"}
                wide
              />
              <KV
                zh="DIALux 报告"
                en="DIALux report"
                value={data.lighting.dialux_name ?? "—"}
              />
            </View>

            {data.lighting.lighting_program.length > 0 && (
              <>
                <BiSub
                  title={{ zh: "调光程序", en: "Dimming schedule" }}
                />
                <View style={s.table}>
                  <View style={s.tHead} fixed>
                    <Text style={[s.tHeadCell, { width: 70 }]}>
                      时段 · Period
                    </Text>
                    <Text style={[s.tHeadCell, { width: 70, textAlign: "right" }]}>
                      输出 · Output
                    </Text>
                    <Text style={[s.tHeadCell, { width: 76, textAlign: "right" }]}>
                      时长 · Duration
                    </Text>
                    <Text style={[s.tHeadCell, { flex: 1, paddingLeft: 10 }]}>
                      感应模式 · Motion sensor
                    </Text>
                  </View>
                  {data.lighting.lighting_program.map((p, i) => (
                    <View
                      key={i}
                      style={i % 2 === 1 ? [s.tRow, s.tRowAlt] : s.tRow}
                      wrap={false}
                    >
                      <Text style={[s.tCellStrong, { width: 70 }]}>
                        Period {i + 1}
                      </Text>
                      <Text style={[s.tCell, { width: 70, textAlign: "right" }]}>
                        {p.output}%
                      </Text>
                      <Text style={[s.tCell, { width: 76, textAlign: "right" }]}>
                        {p.duration_hours} h
                      </Text>
                      <Text style={[s.tCell, { flex: 1, paddingLeft: 10 }]}>
                        {p.presence_detection
                          ? `感应加亮至 ${p.detection_output ?? "—"}% · boost to ${
                              p.detection_output ?? "—"
                            }%${
                              p.detection_hold_seconds
                                ? `, hold ${p.detection_hold_seconds}s`
                                : ""
                            }${
                              p.estimated_detections
                                ? `, ~${p.estimated_detections} detections/night`
                                : ""
                            }`
                          : "固定输出 · Fixed level"}
                      </Text>
                    </View>
                  ))}
                </View>
              </>
            )}

            {data.lighting.dialux_configurations.length > 0 && (
              <>
                <BiSub
                  title={{
                    zh: "DIALux 生产配置",
                    en: "DIALux production configurations",
                  }}
                />
                <View style={s.table}>
                  <View style={s.tHead} fixed>
                    <Text style={[s.tHeadCell, { flex: 2 }]}>区域 · Zone</Text>
                    <Text style={[s.tHeadCell, { width: 50, textAlign: "right" }]}>
                      功率 · W
                    </Text>
                    <Text style={[s.tHeadCell, { width: 60, textAlign: "right" }]}>
                      安装高度 · H (m)
                    </Text>
                    <Text style={[s.tHeadCell, { flex: 2, paddingLeft: 8 }]}>
                      光学 · Optic
                    </Text>
                    <Text style={[s.tHeadCell, { width: 54, textAlign: "right" }]}>
                      色温 · CCT
                    </Text>
                    <Text style={[s.tHeadCell, { width: 44, textAlign: "right" }]}>
                      数量 · Qty
                    </Text>
                  </View>
                  {data.lighting.dialux_configurations.map((c, i) => (
                    <View
                      key={i}
                      style={i % 2 === 1 ? [s.tRow, s.tRowAlt] : s.tRow}
                      wrap={false}
                    >
                      <Text style={[s.tCell, { flex: 2 }]}>
                        {c.label ?? `Config ${i + 1}`}
                      </Text>
                      <Text style={[s.tCell, { width: 50, textAlign: "right" }]}>
                        {c.power ?? "—"}
                      </Text>
                      <Text style={[s.tCell, { width: 60, textAlign: "right" }]}>
                        {c.mounting_height ?? "—"}
                      </Text>
                      <Text style={[s.tCell, { flex: 2, paddingLeft: 8 }]}>
                        {[c.optic_code, c.optic_beam_distribution]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </Text>
                      <Text style={[s.tCell, { width: 54, textAlign: "right" }]}>
                        {c.cct ? `${c.cct}K` : "—"}
                      </Text>
                      <Text style={[s.tCell, { width: 44, textAlign: "right" }]}>
                        {c.quantity ?? "—"}
                      </Text>
                    </View>
                  ))}
                </View>
              </>
            )}
          </View>
        )}

        {/* ---------- STICKERS ---------- */}
        {showStickers && data.stickers && (
          <View break>
            <BiSection n={nStickers} title={S.stickers} />
            {requiredStickers.length === 0 ? (
              <Text style={s.emptyNote}>
                无标签要求 · No sticker requirements.
              </Text>
            ) : (
              <View style={s.table}>
                <View style={s.tHead} fixed>
                  <Text style={[s.tHeadCell, { flex: 2 }]}>标签 · Item</Text>
                  <Text style={[s.tHeadCell, { flex: 1.4 }]}>
                    工艺 · Method
                  </Text>
                  <Text style={[s.tHeadCell, { flex: 1.6 }]}>
                    品牌 · Branding
                  </Text>
                  <Text style={[s.tHeadCell, { flex: 1.6 }]}>
                    位置 · Position
                  </Text>
                  <Text style={[s.tHeadCell, { flex: 3 }]}>备注 · Note</Text>
                </View>
                {requiredStickers.map((it, i) => (
                  <View
                    key={i}
                    style={i % 2 === 1 ? [s.tRow, s.tRowAlt] : s.tRow}
                    wrap={false}
                  >
                    <Text style={[s.tCellStrong, { flex: 2, paddingRight: 6 }]}>
                      {it.label}
                    </Text>
                    <Text style={[s.tCell, { flex: 1.4 }]}>
                      {it.method === "laser"
                        ? "激光 Laser"
                        : it.method === "sticker"
                        ? "贴纸 Sticker"
                        : "—"}
                    </Text>
                    <Text style={[s.tCell, { flex: 1.6 }]}>
                      {it.branding_source === "solux"
                        ? "Solux"
                        : it.branding_source === "customer"
                        ? "客户 Customer"
                        : "—"}
                    </Text>
                    <Text style={[s.tCell, { flex: 1.6 }]}>
                      {it.positioning ?? "—"}
                    </Text>
                    <Text style={[s.tCell, { flex: 3 }]}>{it.note ?? "—"}</Text>
                  </View>
                ))}
              </View>
            )}
            {data.stickers.notes && (
              <View style={{ marginTop: 8 }}>
                <NotesBlock
                  zh="标签总备注"
                  en="Sticker notes"
                  text={data.stickers.notes}
                />
              </View>
            )}
            <Text style={[s.emptyNote, { marginTop: 4 }]}>
              标签图稿见附录 · Sticker artwork files, if uploaded, are included
              in the Appendix.
            </Text>
          </View>
        )}

        {/* ---------- TRANSPORT ---------- */}
        {showTransport && (
          <View break>
            <BiSection n={nTransport} title={S.transport} />
            <View style={s.kvGrid}>
              <KV
                zh="贸易条款"
                en="Incoterm"
                value={data.logistics?.incoterm ?? "—"}
              />
              <KV
                zh="运输方式"
                en="Shipping method"
                value={data.shipping_method ?? data.logistics?.freight_type ?? "—"}
              />
              <KV
                zh="货运类型"
                en="Freight type"
                value={data.logistics?.freight_type ?? "—"}
              />
              <KV
                zh="装运港"
                en="Port of loading"
                value={data.logistics?.port_of_loading ?? "—"}
              />
              <KV
                zh="目的港"
                en="Port of destination"
                value={data.logistics?.port_of_destination ?? "—"}
              />
              <KV
                zh="生产周期"
                en="Production time"
                value={
                  data.logistics?.production_days != null
                    ? `${data.logistics.production_days} days`
                    : data.logistics?.production_date
                    ? fmtDate(data.logistics.production_date)
                    : "—"
                }
              />
            </View>
          </View>
        )}

        {/* ---------- QUALITY / RISKS ---------- */}
        {showQuality && data.risks && (
          <View break>
            <BiSection n={nQuality} title={S.quality} />
            {activeRisks.map((r, i) => (
              <View key={i} style={s.notesBlockWarn} wrap={false}>
                <View style={s.notesLabelRow}>
                  <Text style={s.notesLabelZh}>{r.label}</Text>
                </View>
                {r.note && <Text style={s.notesText}>{r.note}</Text>}
              </View>
            ))}
            {data.risks.notes && (
              <NotesBlock
                zh="质量与风险备注"
                en="Quality & risk notes"
                text={data.risks.notes}
                warn
              />
            )}
          </View>
        )}

        {/* ---------- INTERNAL NOTES ---------- */}
        {showInternal && data.technical_notes && (
          <View break>
            <BiSection n={nInternal} title={S.internal_notes} />
            <NotesBlock
              zh="内部技术备注"
              en="Technical notes (internal)"
              text={data.technical_notes}
              warn
            />
          </View>
        )}

        {/* ---------- UPLOADED DOCUMENTS + APPENDIX INDEX ---------- */}
        <View break>
          <BiSection n={nUploads} title={S.uploads} />
          {appendix.length === 0 ? (
            <Text style={s.emptyNote}>
              本项目无上传文件 · No documents uploaded for this project.
            </Text>
          ) : (
            <View style={s.table}>
              <View style={s.tHead} fixed>
                <Text style={[s.tHeadCell, { width: 44 }]}>编号 · Ref</Text>
                <Text style={[s.tHeadCell, { flex: 3 }]}>文件 · File</Text>
                <Text style={[s.tHeadCell, { flex: 2 }]}>类型 · Type</Text>
                <Text style={[s.tHeadCell, { flex: 2.4 }]}>
                  状态 · Status
                </Text>
              </View>
              {appendix.map((a, i) => (
                <View
                  key={i}
                  style={i % 2 === 1 ? [s.tRow, s.tRowAlt] : s.tRow}
                  wrap={false}
                >
                  <Text style={[s.tCellStrong, { width: 44 }]}>
                    {a.label ?? "—"}
                  </Text>
                  <View style={{ flex: 3, paddingRight: 6 }}>
                    <Text style={s.tCell}>{a.file_name}</Text>
                    {a.note && (
                      <Text
                        style={[s.tCell, { fontSize: 7, color: COLORS.muted }]}
                      >
                        {a.note}
                      </Text>
                    )}
                  </View>
                  <Text style={[s.tCell, { flex: 2 }]}>{a.type_label}</Text>
                  <Text style={[s.tCell, { flex: 2.4 }]}>
                    {a.label
                      ? "已合并至附录 · Included in appendix"
                      : "另行提供 · Provided separately"}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {appendix.some((a) => a.label) && (
            <View style={{ marginTop: GAP_S }}>
              <BiSub title={S.appendix} />
              <Text style={s.notesText}>
                以下附录页为项目上传文件的完整内容，按编号顺序排列（A1、A2…）。
                The following appendix pages contain the uploaded project
                documents in full, in reference order (A1, A2…). 本档案为工厂
                唯一生产依据 · This dossier is the complete production package.
              </Text>
            </View>
          )}
        </View>

        {footer}
      </Page>
    </Document>
  );
}
