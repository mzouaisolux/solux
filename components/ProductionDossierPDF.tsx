"use client";

import { Fragment } from "react";
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
  makeTerms,
  DEFAULT_TERM_DICT,
  type TermDict,
  type Terms,
} from "@/lib/terminology";
import { formatTiltAngle } from "@/lib/industrial-spec";
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
  break: pageBreak = false,
}: {
  n: number;
  title: BiTitle;
  children?: React.ReactNode;
  break?: boolean;
}) {
  return (
    <View style={s.secWrap} wrap={false} break={pageBreak}>
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

function LineConfigTable({ line, T }: { line: ExportLine; T: Terms }) {
  if (line.rows.length === 0) {
    return (
      <Text style={s.emptyNote}>
        {line.is_manual
          ? T.dot("notice.manual_item_no_catalog")
          : T.dot("notice.no_sales_fields")}
      </Text>
    );
  }
  return (
    <View style={s.table}>
      <View style={s.tHead} fixed>
        <Text style={[s.tHeadCell, { flex: 2 }]}>{T.dot("table.field")}</Text>
        <Text style={[s.tHeadCell, { flex: 3 }]}>{T.dot("table.value")}</Text>
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

function LineInstructionCards({ line, T }: { line: ExportLine; T: Terms }) {
  // Instruction cards for every row that carries a factory resolution
  // (mapping / preset / override / missing). Plain informational sales
  // fields are already in the configuration table above.
  const rows = line.rows.filter(
    (r) => r.note !== "Sales field — no mapping required"
  );
  if (rows.length === 0) {
    return (
      <Text style={s.emptyNote}>
        {T.dot("notice.no_factory_mapped_fields")}
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
                {T.dot("field.factory_code")}: {r.factory_code}
              </Text>
            )}

            <View style={s.instructionLabelRow}>
              <Text style={s.notesLabelZh}>{T.zh("factory_instruction.final")}</Text>
              <Text style={s.notesLabelEn}>{T.en("factory_instruction.final")}</Text>
            </View>
            {r.source === "missing" ? (
              <Text style={s.instructionMuted}>
                {T.dot("notice.missing_factory_mapping")}
              </Text>
            ) : (
              <Text style={s.instructionText}>
                {r.final_factory_instruction || "—"}
              </Text>
            )}

            {r.source === "override" && r.factory_mapping_instruction && (
              <>
                <View style={s.instructionLabelRow}>
                  <Text style={s.notesLabelZh}>{T.zh("factory_instruction.standard_overridden")}</Text>
                  <Text style={s.notesLabelEn}>
                    {T.en("factory_instruction.standard_overridden")}
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

function LineBatteryBlock({ line, T }: { line: ExportLine; T: Terms }) {
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
      <BiSub title={T.bi("section.battery")} />
      <View style={s.batteryBox} wrap={false}>
        {line.battery_cell_type && (
          <View style={s.batteryTypeRow}>
            <Text style={s.notesLabelZh}>{T.zh("field.battery_type")}</Text>
            <Text style={s.notesLabelEn}>{T.en("field.battery_type")}</Text>
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
  terms,
}: {
  data: ExportData;
  /** Planned appendix (labels assigned) — pages merged post-render by pdf-lib. */
  appendix: AppendixItem[];
  /**
   * m177 — the centralized vocabulary. Optional so an older caller still
   * renders: omitted, every term resolves from the built-in catalog, which is
   * exactly what this document printed before the terminology table existed.
   */
  terms?: TermDict;
}) {
  const T = makeTerms(terms ?? DEFAULT_TERM_DICT);
  // Section titles resolve through the dictionary too — the built-in catalog
  // carries the same values, so this is identical output until someone edits
  // a title in Admin → Terminology.
  const S = Object.fromEntries(
    Object.keys(DOSSIER_SECTIONS).map((k) => [k, T.bi(`section.${k}`)])
  ) as Record<keyof typeof DOSSIER_SECTIONS, BiTitle>;
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
  // m159 — industrial production file: render when the columns exist AND the
  // TLM actually set something (tilt angle or a saved spec blob). Pre-m159
  // task lists (industrial = null) simply omit the section.
  const industrial = data.industrial;
  const showIndustrial = !!(
    industrial &&
    (industrial.solar_panel_tilt_angle != null || industrial.spec)
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
  const nIndustrial = showIndustrial ? num() : 0;
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
            {T.en("notice.complete_package")} · {T.zh("notice.complete_package")}
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
              {...T.kv("field.client")}
              value={
                data.client.company_name +
                (data.client.client_code ? ` · ${data.client.client_code}` : "")
              }
            />
            <KV {...T.kv("field.country")} value={data.client.country ?? "—"} />
            <KV {...T.kv("field.contact")} value={data.client.contact_name ?? "—"} />
          </View>
        </View>

        <Rule />

        <View>
          <BiSub title={S.project} />
          <View style={s.kvGrid}>
            <KV
              {...T.kv("field.order_reference")}
              value={data.quotation_number ?? "—"}
            />
            <KV {...T.kv("field.task_list")} value={data.number} />
            <KV
              {...T.kv("field.status")}
              value={data.status.replace(/_/g, " ").toUpperCase()}
            />
            <KV {...T.kv("field.created")} value={fmtDate(data.created_at)} />
            <KV {...T.kv("field.created_by")} value={data.created_by_label} />
            <KV
              {...T.kv("field.validated_by")}
              value={data.validated_by_label}
            />
            <KV
              {...T.kv("field.validated_on")}
              value={fmtDate(data.validated_at)}
            />
            <KV
              {...T.kv("field.shipping_method")}
              value={data.shipping_method ?? "—"}
            />
            <KV {...T.kv("field.generated")} value={generatedAt} />
          </View>
        </View>

        <Rule />

        {/* Document map — what this dossier contains (no page numbers:
            sections are numbered, the reader follows the running order). */}
        <View>
          <BiSub title={T.bi("section.contents")} />
          {[
            `${nSummary}. ${S.order_summary.zh} · ${S.order_summary.en}`,
            ...(showNotes
              ? [`${nNotes}. ${S.production_notes.zh} · ${S.production_notes.en}`]
              : []),
            ...data.lines.map(
              (l, i) =>
                `${lineNumbers[i]}. ${S.product_configuration.zh} · ${S.product_configuration.en} — ${l.product_name}`
            ),
            ...(showIndustrial
              ? [`${nIndustrial}. ${S.industrial_file.zh} · ${S.industrial_file.en}`]
              : []),
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
            <Text style={[s.tHeadCell, { flex: 3 }]}>{T.dot("table.product")}</Text>
            <Text style={[s.tHeadCell, { flex: 2 }]}>{T.dot("table.category")}</Text>
            <Text style={[s.tHeadCell, { width: 44, textAlign: "right" }]}>{T.dot("table.qty")}</Text>
            <Text style={[s.tHeadCell, { flex: 4, paddingLeft: 8 }]}>{T.dot("table.main_configuration")}</Text>
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
                {...T.kv("field.original_sales_request")}
                text={data.original_sales_request}
              />
            )}
            {data.production_notes && (
              <NotesBlock
                {...T.kv("field.production_notes_sales")}
                text={data.production_notes}
              />
            )}
          </View>
        )}

        {/* ---------- PER-PRODUCT SECTIONS ----------
            No wrapping <View>: a section that fills its page exactly would
            spill its trailing child margin onto a blank continuation page
            (empty page artefact). The break lives on the BiSection instead. */}
        {data.lines.map((l, i) => (
          <Fragment key={i}>
            <BiSection
              break
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
                <Text style={s.lineQtyLabel}>{T.dot("table.qty")}</Text>
                <Text style={s.lineQtyValue}>× {l.quantity}</Text>
              </View>
            </View>

            {l.is_manual && l.manual_specs && (
              <NotesBlock
                {...T.kv("field.manual_specs")}
                text={l.manual_specs}
              />
            )}

            <LineConfigTable line={l} T={T} />

            <BiSub
              title={{
                zh: `${S.factory_mapping.zh} · ${S.factory_instructions.zh}`,
                en: `${S.factory_mapping.en} · ${S.factory_instructions.en}`,
              }}
            />
            <LineInstructionCards line={l} T={T} />

            <LineBatteryBlock line={l} T={T} />

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
                {...T.kv("field.line_notes")}
                text={l.internal_notes}
              />
            )}
          </Fragment>
        ))}

        {/* ---------- INDUSTRIAL PRODUCTION FILE (m159) ---------- */}
        {showIndustrial && industrial && (
          <View break>
            <BiSection n={nIndustrial} title={S.industrial_file} />

            {/* Tilt angle + pole drawing checkpoint — critical production
                parameter, boxed like the battery block. */}
            {industrial.solar_panel_tilt_angle != null && (
              <>
                <BiSub title={S.tilt_angle} />
                <View style={s.batteryBox} wrap={false}>
                  <View style={s.batteryTypeRow}>
                    <Text style={s.notesLabelZh}>{S.tilt_angle.zh}</Text>
                    <Text style={s.notesLabelEn}>{S.tilt_angle.en}</Text>
                    <Text style={s.batteryTypeValue}>
                      {formatTiltAngle(industrial.solar_panel_tilt_angle)}
                    </Text>
                  </View>
                  {industrial.pole_drawing_tilt_verified ? (
                    <Text style={s.notesText}>
                      {T.dot("notice.tilt_checked")}
                      {industrial.pole_drawing_tilt_verified_at
                        ? ` (${fmtDate(industrial.pole_drawing_tilt_verified_at)})`
                        : ""}
                      .
                    </Text>
                  ) : (
                    <Text style={s.instructionMuted}>{T.dot("notice.tilt_not_checked")}</Text>
                  )}
                </View>
              </>
            )}

            {industrial.spec && (
              <>
                {/* Pole accessories — included by default, unchecked rows are
                    explicit exclusions the factory must respect. */}
                <BiSub title={S.pole_accessories} />
                <View style={s.table}>
                  <View style={s.tHead} fixed>
                    <Text style={[s.tHeadCell, { flex: 2.4 }]}>{T.dot("table.accessory")}</Text>
                    <Text style={[s.tHeadCell, { flex: 1.6 }]}>{T.dot("table.included")}</Text>
                    <Text style={[s.tHeadCell, { flex: 3 }]}>{T.dot("table.note")}</Text>
                  </View>
                  {industrial.spec.pole_accessories.items.map((it, i) => (
                    <View
                      key={i}
                      style={i % 2 === 1 ? [s.tRow, s.tRowAlt] : s.tRow}
                      wrap={false}
                    >
                      <Text style={[s.tCellStrong, { flex: 2.4, paddingRight: 6 }]}>
                        {it.label}
                      </Text>
                      <Text
                        style={[
                          s.tCell,
                          { flex: 1.6 },
                          it.included ? {} : { color: COLORS.dangerText },
                        ]}
                      >
                        {it.included ? T.dot("status.included") : T.dot("status.excluded")}
                      </Text>
                      <Text style={[s.tCell, { flex: 3 }]}>{it.note ?? "—"}</Text>
                    </View>
                  ))}
                </View>
                {industrial.spec.pole_accessories.notes && (
                  <View style={{ marginTop: 6 }}>
                    <NotesBlock
                      {...T.kv("field.accessory_notes")}
                      text={industrial.spec.pole_accessories.notes}
                    />
                  </View>
                )}

                {/* Packaging version */}
                {(industrial.spec.packaging.version ||
                  industrial.spec.packaging.notes) && (
                  <>
                    <BiSub title={S.packaging} />
                    <View style={s.kvGrid}>
                      <KV
                        {...T.kv("field.packaging_version")}
                        value={
                          industrial.spec.packaging.version
                            ? T.dot(`enum.packaging.${industrial.spec.packaging.version}`)
                            : "—"
                        }
                        wide
                      />
                    </View>
                    {industrial.spec.packaging.version === "custom_client" && (
                      <Text style={[s.emptyNote, { marginBottom: 6 }]}>{T.dot("notice.packaging_artwork_appendix")}</Text>
                    )}
                    {industrial.spec.packaging.notes && (
                      <NotesBlock
                        {...T.kv("field.packaging_notes")}
                        text={industrial.spec.packaging.notes}
                      />
                    )}
                  </>
                )}

                {/* User manual */}
                {(industrial.spec.user_manual.brand ||
                  industrial.spec.user_manual.languages.length > 0 ||
                  industrial.spec.user_manual.notes) && (
                  <>
                    <BiSub title={S.user_manual} />
                    <View style={s.kvGrid}>
                      <KV
                        {...T.kv("field.manual_version")}
                        value={
                          industrial.spec.user_manual.brand
                            ? T.dot(`enum.manual_brand.${industrial.spec.user_manual.brand}`)
                            : "—"
                        }
                        wide
                      />
                      <KV
                        {...T.kv("field.languages")}
                        value={
                          industrial.spec.user_manual.languages.length > 0
                            ? industrial.spec.user_manual.languages
                                .map(
                                  (l) =>
                                    `${T.zh(`enum.manual_language.${l}`)} ${T.en(`enum.manual_language.${l}`)}`
                                )
                                .join(", ")
                            : "—"
                        }
                      />
                    </View>
                    {industrial.spec.user_manual.brand === "custom" && (
                      <Text style={[s.emptyNote, { marginBottom: 6 }]}>{T.dot("notice.manual_artwork_appendix")}</Text>
                    )}
                    {industrial.spec.user_manual.notes && (
                      <NotesBlock
                        {...T.kv("field.manual_notes")}
                        text={industrial.spec.user_manual.notes}
                      />
                    )}
                  </>
                )}

                {/* Spare parts — structured table incl. factory naming
                    (factories name identical parts differently). */}
                {industrial.spec.spare_parts.length > 0 && (
                  <>
                    <BiSub title={S.spare_parts} />
                    <View style={s.table}>
                      <View style={s.tHead} fixed>
                        <Text style={[s.tHeadCell, { flex: 2 }]}>{T.dot("table.part")}</Text>
                        <Text style={[s.tHeadCell, { flex: 2 }]}>{T.dot("table.model")}</Text>
                        <Text
                          style={[s.tHeadCell, { width: 44, textAlign: "right" }]}
                        >{T.dot("table.qty")}</Text>
                        <Text style={[s.tHeadCell, { flex: 2, paddingLeft: 8 }]}>{T.dot("table.factory_name")}</Text>
                        <Text style={[s.tHeadCell, { flex: 2.4 }]}>{T.dot("table.note")}</Text>
                      </View>
                      {industrial.spec.spare_parts.map((p, i) => (
                        <View
                          key={i}
                          style={i % 2 === 1 ? [s.tRow, s.tRowAlt] : s.tRow}
                          wrap={false}
                        >
                          <View style={{ flex: 2, paddingRight: 6 }}>
                            <Text style={s.tCellStrong}>{p.part || "—"}</Text>
                            {p.customer_name && (
                              <Text
                                style={[s.tCell, { fontSize: 7, color: COLORS.muted }]}
                              >
                                {T.zh("field.customer_naming")} {T.en("field.customer_naming")}: {p.customer_name}
                              </Text>
                            )}
                          </View>
                          <Text style={[s.tCell, { flex: 2, paddingRight: 6 }]}>
                            {p.model ?? "—"}
                          </Text>
                          <Text
                            style={[
                              s.tCellStrong,
                              { width: 44, textAlign: "right" },
                            ]}
                          >
                            × {p.quantity}
                          </Text>
                          <View style={{ flex: 2, paddingLeft: 8 }}>
                            <Text style={s.tCell}>{p.factory_name ?? "—"}</Text>
                            {/* m160 — official Chinese factory terminology +
                                ERP code from the Product Dictionary snapshot:
                                what the factory actually reads. */}
                            {p.factory_name_cn && (
                              <Text style={s.tCell}>{p.factory_name_cn}</Text>
                            )}
                            {p.erp_code && (
                              <Text
                                style={[s.tCell, { fontSize: 7, color: COLORS.muted }]}
                              >
                                ERP: {p.erp_code}
                              </Text>
                            )}
                            {p.factory_notes && (
                              <Text
                                style={[s.tCell, { fontSize: 7, color: COLORS.muted }]}
                              >
                                {p.factory_notes}
                              </Text>
                            )}
                          </View>
                          <Text style={[s.tCell, { flex: 2.4 }]}>
                            {p.notes ?? "—"}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </>
                )}
              </>
            )}
          </View>
        )}

        {/* ---------- LIGHTING PROGRAM + ENERGY ---------- */}
        {showLighting && data.lighting && (
          <View break>
            <BiSection n={nLighting} title={S.lighting_program} />

            <BiSub title={S.energy} />
            <View style={s.kvGrid}>
              <KV
                {...T.kv("field.lighting_power")}
                value={
                  data.lighting.lighting_power != null
                    ? `${data.lighting.lighting_power} W`
                    : "—"
                }
              />
              <KV
                {...T.kv("field.operating_hours")}
                value={
                  data.lighting.operating_hours != null
                    ? `${data.lighting.operating_hours} h`
                    : "—"
                }
              />
              <KV
                {...T.kv("field.approved_optics")}
                value={data.lighting.approved_optics ?? "—"}
              />
              <KV
                {...T.kv("field.energy_study")}
                value={data.lighting.energy_study_name ?? "—"}
                wide
              />
              <KV
                {...T.kv("field.dialux_report")}
                value={data.lighting.dialux_name ?? "—"}
              />
            </View>

            {data.lighting.lighting_program.length > 0 && (
              <>
                <BiSub
                  title={T.bi("section.dimming_schedule")}
                />
                <View style={s.table}>
                  <View style={s.tHead} fixed>
                    <Text style={[s.tHeadCell, { width: 70 }]}>{T.dot("table.period")}</Text>
                    <Text style={[s.tHeadCell, { width: 70, textAlign: "right" }]}>{T.dot("table.output")}</Text>
                    <Text style={[s.tHeadCell, { width: 76, textAlign: "right" }]}>{T.dot("table.duration")}</Text>
                    <Text style={[s.tHeadCell, { flex: 1, paddingLeft: 10 }]}>{T.dot("table.motion_sensor")}</Text>
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
                          ? `${T.zh("status.motion_boost")} ${p.detection_output ?? "—"}% · ${T.en("status.motion_boost")} ${
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
                          : T.dot("status.fixed_level")}
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
                    ...T.bi("section.dialux_configs"),
                  }}
                />
                <View style={s.table}>
                  <View style={s.tHead} fixed>
                    <Text style={[s.tHeadCell, { flex: 2 }]}>{T.dot("table.zone")}</Text>
                    <Text style={[s.tHeadCell, { width: 50, textAlign: "right" }]}>{T.dot("table.power_w")}</Text>
                    <Text style={[s.tHeadCell, { width: 60, textAlign: "right" }]}>{T.dot("table.mounting_height")}</Text>
                    <Text style={[s.tHeadCell, { flex: 2, paddingLeft: 8 }]}>{T.dot("table.optic")}</Text>
                    <Text style={[s.tHeadCell, { width: 54, textAlign: "right" }]}>{T.dot("table.cct")}</Text>
                    <Text style={[s.tHeadCell, { width: 44, textAlign: "right" }]}>{T.dot("table.qty")}</Text>
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
              <Text style={s.emptyNote}>{T.dot("notice.no_stickers")}</Text>
            ) : (
              <View style={s.table}>
                <View style={s.tHead} fixed>
                  <Text style={[s.tHeadCell, { flex: 2 }]}>{T.dot("table.sticker_item")}</Text>
                  <Text style={[s.tHeadCell, { flex: 1.4 }]}>{T.dot("table.method")}</Text>
                  <Text style={[s.tHeadCell, { flex: 1.6 }]}>{T.dot("table.branding")}</Text>
                  <Text style={[s.tHeadCell, { flex: 1.6 }]}>{T.dot("table.position")}</Text>
                  <Text style={[s.tHeadCell, { flex: 3 }]}>{T.dot("table.note")}</Text>
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
                        ? `${T.zh("status.laser")} ${T.en("status.laser")}`
                        : it.method === "sticker"
                        ? `${T.zh("status.sticker")} ${T.en("status.sticker")}`
                        : "—"}
                    </Text>
                    <Text style={[s.tCell, { flex: 1.6 }]}>
                      {it.branding_source === "solux"
                        ? "Solux"
                        : it.branding_source === "customer"
                        ? `${T.zh("status.branding_customer")} ${T.en("status.branding_customer")}`
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
                  {...T.kv("field.sticker_notes")}
                  text={data.stickers.notes}
                />
              </View>
            )}
            <Text style={[s.emptyNote, { marginTop: 4 }]}>{T.dot("notice.sticker_artwork_appendix")}</Text>
          </View>
        )}

        {/* ---------- TRANSPORT ---------- */}
        {showTransport && (
          <View break>
            <BiSection n={nTransport} title={S.transport} />
            <View style={s.kvGrid}>
              <KV
                {...T.kv("field.incoterm")}
                value={data.logistics?.incoterm ?? "—"}
              />
              <KV
                {...T.kv("field.shipping_method")}
                value={data.shipping_method ?? data.logistics?.freight_type ?? "—"}
              />
              <KV
                {...T.kv("field.freight_type")}
                value={data.logistics?.freight_type ?? "—"}
              />
              <KV
                {...T.kv("field.port_of_loading")}
                value={data.logistics?.port_of_loading ?? "—"}
              />
              <KV
                {...T.kv("field.port_of_destination")}
                value={data.logistics?.port_of_destination ?? "—"}
              />
              <KV
                {...T.kv("field.production_time")}
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
                {...T.kv("field.quality_risk_notes")}
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
              {...T.kv("field.technical_notes_internal")}
              text={data.technical_notes}
              warn
            />
          </View>
        )}

        {/* ---------- UPLOADED DOCUMENTS + APPENDIX INDEX ---------- */}
        <View break>
          <BiSection n={nUploads} title={S.uploads} />
          {appendix.length === 0 ? (
            <Text style={s.emptyNote}>{T.dot("notice.no_uploads")}</Text>
          ) : (
            <View style={s.table}>
              <View style={s.tHead} fixed>
                <Text style={[s.tHeadCell, { width: 44 }]}>{T.dot("table.ref")}</Text>
                <Text style={[s.tHeadCell, { flex: 3 }]}>{T.dot("table.file")}</Text>
                <Text style={[s.tHeadCell, { flex: 2 }]}>{T.dot("table.type")}</Text>
                <Text style={[s.tHeadCell, { flex: 2.4 }]}>{T.dot("table.status")}</Text>
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
                      ? T.dot("status.in_appendix")
                      : T.dot("status.provided_separately")}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {appendix.some((a) => a.label) && (
            <View style={{ marginTop: GAP_S }}>
              <BiSub title={S.appendix} />
              <Text style={s.notesText}>
                {T.zh("notice.appendix_preamble")}{" "}
                {T.en("notice.appendix_preamble")}
              </Text>
            </View>
          )}
        </View>

        {footer}
      </Page>
    </Document>
  );
}
