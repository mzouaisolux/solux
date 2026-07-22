"use client";

import { Fragment } from "react";
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type {
  ExportData,
  ExportLine,
} from "@/app/(app)/task-lists/[id]/exportData";
import {
  DOSSIER_SECTIONS,
  MANUAL_BRAND_TITLES,
  MANUAL_LANGUAGE_TITLES,
  PACKAGING_VERSION_TITLES,
  type AppendixItem,
} from "@/lib/production-dossier";
import { formatTiltAngle } from "@/lib/industrial-spec";
import { BrandHeader, COLORS, F, M_OUT } from "@/components/pdf/theme";

/**
 * Production Dossier PDF — the COMPLETE production package generated from a
 * validated task list.
 *
 * Design brief (owner spec, 2026-07-15 — "factory build sheet, not a report"):
 *   Production engineers rejected the previous long/airy layout (10 core
 *   pages for one product). They want the density of the hand-made factory
 *   sheet: ONE product = one contiguous build block, every fabrication value
 *   visible at a glance, exceptions jumping out, no marketing whitespace, few
 *   page breaks. This layout keeps the SOLUX identity (logo, neutral palette,
 *   bilingual 中文/EN) and ALL the generated features (factory mapping /
 *   override / missing, industrial file, lighting program, stickers, spare
 *   parts, uploads) but presents them as dense tables and inline rows so the
 *   core collapses to ~2-3 pages. The reference studies (Energy / DIALux /
 *   drawings) stay in the merged Appendix, indexed at the end.
 *
 * Information hierarchy:
 *   L1 (hero)  — model, qty, FINAL factory build spec, battery, panel, LED,
 *                CCT, tilt, program.
 *   L2         — packaging, manual, stickers, accessories, transport.
 *   L3 (small) — override traceability, uploads index.
 *
 * CJK: @react-pdf has NO per-glyph fallback — every Text that can carry
 * Chinese or user-entered text is EXPLICITLY the Noto Sans SC family (F.cjk).
 */

/* Page numbers over the WHOLE package (core + appendix) are stamped by
   mergeDossierWithAppendix; this body carries none. */

const s = StyleSheet.create({
  page: {
    paddingTop: M_OUT - 6,
    paddingBottom: 26,
    paddingHorizontal: M_OUT - 6,
    fontFamily: F.body,
    fontWeight: 200,
    fontSize: 8,
    color: COLORS.body,
    lineHeight: 1.35,
  },
  contentTop: { paddingTop: M_OUT + 4 }, // room for the fixed running header

  /* ----- Running header / footer ----- */
  runHead: {
    position: "absolute",
    top: 12,
    left: M_OUT - 6,
    right: M_OUT - 6,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.hair,
    paddingBottom: 3,
  },
  runHeadL: {
    fontFamily: F.cjk,
    fontSize: 7,
    fontWeight: 400,
    color: COLORS.ink,
    letterSpacing: 0.3,
  },
  runHeadR: {
    fontFamily: F.cjk,
    fontSize: 7,
    fontWeight: 400,
    color: COLORS.muted,
    maxWidth: "50%",
    textAlign: "right",
  },
  footer: {
    position: "absolute",
    bottom: 12,
    left: M_OUT - 6,
    right: M_OUT - 6,
    fontFamily: F.cjk,
    fontSize: 6.5,
    fontWeight: 400,
    color: COLORS.muted,
    textAlign: "center",
    letterSpacing: 0.5,
    borderTopWidth: 0.5,
    borderTopColor: COLORS.hair,
    paddingTop: 4,
  },

  /* ----- Masthead ----- */
  titleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginTop: 10,
    marginBottom: 6,
  },
  titleZh: {
    fontFamily: F.cjk,
    fontSize: 15,
    fontWeight: 600,
    color: COLORS.ink,
    letterSpacing: 3,
  },
  titleEn: {
    // F.cjk — the caption + status line mix Latin with Chinese (工厂完整生产文件 /
    // 已核准); a Latin-only face here renders the CJK as mojibake.
    fontFamily: F.cjk,
    fontWeight: 400,
    fontSize: 7.5,
    color: COLORS.muted,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginTop: 2,
  },
  titleNum: {
    fontFamily: F.body,
    fontWeight: 900,
    fontSize: 13,
    color: COLORS.ink,
    letterSpacing: 0.4,
  },

  /* ----- Identity band ----- */
  band: {
    borderWidth: 0.5,
    borderColor: COLORS.ink,
    marginBottom: 4,
  },
  bandRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.hair,
  },
  bandRowLast: { flexDirection: "row" },
  bandCell: {
    paddingVertical: 3.5,
    paddingHorizontal: 6,
    borderRightWidth: 0.5,
    borderRightColor: COLORS.hair,
  },
  bandLabel: {
    fontFamily: F.cjk,
    fontSize: 6,
    fontWeight: 400,
    color: COLORS.muted,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  bandValue: {
    fontFamily: F.cjk,
    fontSize: 8.5,
    fontWeight: 600,
    color: COLORS.ink,
    marginTop: 0.5,
  },

  /* ----- Section header (compact) ----- */
  sec: {
    flexDirection: "row",
    alignItems: "baseline",
    marginTop: 11,
    marginBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.ink,
    paddingBottom: 2.5,
  },
  secZh: {
    fontFamily: F.cjk,
    fontSize: 10.5,
    fontWeight: 600,
    color: COLORS.ink,
    letterSpacing: 1,
  },
  secEn: {
    fontFamily: F.title,
    fontSize: 7,
    fontWeight: 300,
    color: COLORS.muted,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginLeft: 8,
  },
  secNote: {
    fontFamily: F.cjk,
    fontSize: 7,
    fontWeight: 400,
    color: COLORS.muted,
    marginLeft: "auto",
  },

  /* ----- Product bar ----- */
  prodBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: COLORS.fill,
    borderLeftWidth: 2.5,
    borderLeftColor: COLORS.ink,
    paddingVertical: 4,
    paddingHorizontal: 7,
    marginTop: 7,
    marginBottom: 3,
  },
  prodName: {
    fontFamily: F.cjk,
    fontSize: 11,
    fontWeight: 600,
    color: COLORS.ink,
    letterSpacing: 0.2,
  },
  prodMeta: {
    fontFamily: F.cjk,
    fontSize: 7,
    fontWeight: 400,
    color: COLORS.muted,
    marginTop: 0.5,
  },
  prodQtyLabel: {
    fontFamily: F.cjk,
    fontSize: 6.5,
    fontWeight: 400,
    color: COLORS.muted,
    letterSpacing: 0.6,
    textAlign: "right",
  },
  prodQty: {
    fontFamily: F.body,
    fontSize: 14,
    fontWeight: 900,
    color: COLORS.ink,
    textAlign: "right",
  },

  /* ----- Tables ----- */
  tHead: {
    flexDirection: "row",
    backgroundColor: COLORS.fill,
    borderBottomWidth: 0.75,
    borderBottomColor: COLORS.muted,
    paddingVertical: 3,
    paddingHorizontal: 5,
  },
  th: {
    fontFamily: F.cjk,
    fontSize: 6.8,
    fontWeight: 600,
    color: COLORS.muted,
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  tRow: {
    flexDirection: "row",
    paddingVertical: 2.6,
    paddingHorizontal: 5,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.hair,
    alignItems: "flex-start",
  },
  tRowAlt: { backgroundColor: "#FBFBFC" },
  tRowWarn: { backgroundColor: COLORS.warnBg },
  tRowDanger: { backgroundColor: COLORS.dangerBg },
  td: {
    fontFamily: F.cjk,
    fontSize: 8,
    fontWeight: 200,
    color: COLORS.body,
  },
  tdStrong: {
    fontFamily: F.cjk,
    fontSize: 8,
    fontWeight: 600,
    color: COLORS.ink,
  },
  tdSpec: {
    fontFamily: F.cjk,
    fontSize: 8.5,
    fontWeight: 600,
    color: COLORS.ink,
  },
  tdStd: {
    fontFamily: F.cjk,
    fontSize: 6.8,
    fontWeight: 400,
    color: COLORS.muted,
    marginTop: 0.5,
  },
  tdMissing: {
    fontFamily: F.cjk,
    fontSize: 8,
    fontWeight: 400,
    color: COLORS.dangerText,
  },

  /* ----- Status chip ----- */
  chip: {
    fontFamily: F.body,
    fontSize: 5.8,
    fontWeight: 700,
    borderWidth: 0.5,
    borderRadius: 1.5,
    paddingHorizontal: 3,
    paddingVertical: 0.8,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    textAlign: "center",
  },
  chipOverride: { color: COLORS.warnText, borderColor: COLORS.warnBorder },
  chipMissing: {
    color: COLORS.dangerText,
    borderColor: COLORS.dangerBorder,
    backgroundColor: "#fff",
  },
  chipCell: {
    fontFamily: F.body,
    fontSize: 8,
    fontWeight: 700,
    color: COLORS.ink,
    backgroundColor: "#fff",
    borderWidth: 0.5,
    borderColor: COLORS.ink,
    paddingHorizontal: 4,
    paddingVertical: 0.5,
  },

  /* ----- Two-column KV strip ----- */
  kvWrap: { flexDirection: "row", flexWrap: "wrap", marginTop: 1 },
  kvCell: {
    width: "50%",
    flexDirection: "row",
    alignItems: "baseline",
    paddingVertical: 2,
    paddingRight: 8,
  },
  kvCell3: {
    width: "33.33%",
    flexDirection: "row",
    alignItems: "baseline",
    paddingVertical: 2,
    paddingRight: 8,
  },
  kvLabel: {
    fontFamily: F.cjk,
    fontSize: 7,
    fontWeight: 400,
    color: COLORS.muted,
    width: "42%",
  },
  kvValue: {
    fontFamily: F.cjk,
    fontSize: 8,
    fontWeight: 600,
    color: COLORS.ink,
    flex: 1,
  },

  /* ----- Inline note ----- */
  note: {
    borderLeftWidth: 2,
    borderLeftColor: COLORS.hair,
    paddingLeft: 6,
    paddingVertical: 2,
    marginTop: 2,
    marginBottom: 3,
  },
  noteWarn: { borderLeftColor: COLORS.dangerBorder, backgroundColor: COLORS.dangerBg },
  noteLabel: {
    fontFamily: F.cjk,
    fontSize: 6.5,
    fontWeight: 600,
    color: COLORS.muted,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    marginBottom: 1,
  },
  noteText: {
    fontFamily: F.cjk,
    fontSize: 8,
    fontWeight: 200,
    color: COLORS.body,
    lineHeight: 1.4,
  },
  empty: {
    fontFamily: F.cjk,
    fontSize: 7.5,
    fontWeight: 200,
    color: COLORS.muted,
    fontStyle: "italic",
    marginTop: 1,
  },
});

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB");
}

const STATUS_ZH: Record<string, string> = {
  draft: "草稿",
  submitted: "已提交",
  under_validation: "待核准",
  validated: "已核准",
  factory_sent: "已发厂",
  completed: "已完成",
};

/* ------------------------------- primitives ------------------------------- */

function Section({
  zh,
  en,
  note,
}: {
  zh: string;
  en: string;
  note?: string;
}) {
  return (
    <View style={s.sec} wrap={false}>
      <Text style={s.secZh}>{zh}</Text>
      <Text style={s.secEn}>{en}</Text>
      {note ? <Text style={s.secNote}>{note}</Text> : null}
    </View>
  );
}

function KV({
  zh,
  en,
  value,
  cols = 2,
}: {
  zh: string;
  en: string;
  value: string;
  cols?: 2 | 3;
}) {
  return (
    <View style={cols === 3 ? s.kvCell3 : s.kvCell}>
      <Text style={s.kvLabel}>
        {zh} · {en}
      </Text>
      <Text style={s.kvValue}>{value || "—"}</Text>
    </View>
  );
}

/* --------------------------- per-line build sheet -------------------------- */

type BuildRow = {
  item: string;
  final: string;
  std: string | null;
  status: "override" | "missing" | null;
  /** highlighted value cell (battery cell type) */
  chip?: boolean;
};

/** Merge the sales-config rows + factory resolution into ONE deduped list of
 *  fabrication rows carrying only what the factory builds to. */
function buildRows(line: ExportLine): BuildRow[] {
  const rank: Record<string, number> = {
    override: 4,
    mapping: 3,
    client_preset: 3,
    missing: 1,
  };
  const byKey = new Map<string, ExportLine["rows"][number]>();
  for (const r of line.rows) {
    const key = r.field_name.trim().toLowerCase();
    const prev = byKey.get(key);
    const score = (rank[r.source] ?? 0) + (r.final_factory_instruction ? 0.5 : 0);
    const prevScore = prev
      ? (rank[prev.source] ?? 0) + (prev.final_factory_instruction ? 0.5 : 0)
      : -1;
    if (!prev || score > prevScore) byKey.set(key, r);
  }

  const out: BuildRow[] = [];
  for (const r of byKey.values()) {
    if (r.source === "missing") {
      out.push({ item: r.field_name, final: "", std: null, status: "missing" });
    } else {
      out.push({
        item: r.field_name,
        final: r.final_factory_instruction || r.sales_value || "—",
        std:
          r.source === "override" && r.factory_mapping_instruction
            ? r.factory_mapping_instruction
            : null,
        status: r.source === "override" ? "override" : null,
      });
    }
  }

  // Battery cell technology — highlighted row, placed next to the Battery row.
  if (line.battery_cell_type) {
    const cellRow: BuildRow = {
      item: "Battery cell · 电芯",
      final: line.battery_cell_type,
      std: null,
      status: null,
      chip: true,
    };
    const bi = out.findIndex((o) => o.item.trim().toLowerCase() === "battery");
    if (bi >= 0) out.splice(bi + 1, 0, cellRow);
    else out.push(cellRow);
  }

  // Technical references (controller, LED head…) — factory build inputs.
  for (const e of line.technical_entries)
    out.push({ item: e.label, final: e.value || "—", std: null, status: null });
  // Additional factory parameters (m071).
  for (const e of line.factory_extras)
    out.push({
      item: e.label,
      final: e.value || "—",
      std: null,
      status: null,
    });

  return out;
}

function LineBuild({ line }: { line: ExportLine }) {
  const rows = buildRows(line);
  const overrides = rows.filter((r) => r.status === "override").length;
  const missing = rows.filter((r) => r.status === "missing").length;
  const flags = [
    overrides ? `${overrides} 覆盖 override` : "",
    missing ? `${missing} 缺失 MISSING` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <View wrap={false}>
      <View style={s.prodBar}>
        <View style={{ flex: 1, paddingRight: 8 }}>
          <Text style={s.prodName}>{line.product_name}</Text>
          <Text style={s.prodMeta}>
            {[line.product_sku, line.product_category].filter(Boolean).join(" · ") ||
              (line.is_manual ? "非标准件 · Manual item" : "—")}
          </Text>
        </View>
        <View>
          <Text style={s.prodQtyLabel}>数量 · QTY</Text>
          <Text style={s.prodQty}>× {line.quantity}</Text>
        </View>
      </View>

      {line.is_manual && line.manual_specs ? (
        <View style={s.note}>
          <Text style={s.noteLabel}>产品规格 · Specification (manual item)</Text>
          <Text style={s.noteText}>{line.manual_specs}</Text>
        </View>
      ) : null}

      {rows.length > 0 ? (
        <View>
          <View style={s.tHead} fixed>
            <Text style={[s.th, { flex: 2.1, paddingRight: 6 }]}>
              生产项 · Item
            </Text>
            <Text style={[s.th, { flex: 4 }]}>
              工厂生产规格 · Factory Build Spec
            </Text>
            <Text style={[s.th, { width: 58, textAlign: "right" }]}>
              状态 · Status
            </Text>
          </View>
          {rows.map((r, i) => {
            // Exception tints take precedence over the zebra stripe.
            const tint =
              r.status === "missing"
                ? s.tRowDanger
                : r.status === "override"
                ? s.tRowWarn
                : i % 2 === 1
                ? s.tRowAlt
                : undefined;
            return (
              <View key={i} style={tint ? [s.tRow, tint] : s.tRow} wrap={false}>
                <Text style={[s.tdStrong, { flex: 2.1, paddingRight: 6 }]}>
                  {r.item}
                </Text>
                <View style={{ flex: 4 }}>
                  {r.status === "missing" ? (
                    <Text style={s.tdMissing}>
                      缺工厂映射 · No factory mapping — set a line override.
                    </Text>
                  ) : r.chip ? (
                    <View style={{ flexDirection: "row" }}>
                      <Text style={s.chipCell}>{r.final}</Text>
                    </View>
                  ) : (
                    <Text style={s.tdSpec}>{r.final}</Text>
                  )}
                  {r.std ? (
                    <Text style={s.tdStd}>标准 std · {r.std}</Text>
                  ) : null}
                </View>
                <View style={{ width: 58, alignItems: "flex-end" }}>
                  {r.status === "override" ? (
                    <Text style={[s.chip, s.chipOverride]}>Override</Text>
                  ) : r.status === "missing" ? (
                    <Text style={[s.chip, s.chipMissing]}>Missing</Text>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      ) : line.is_manual ? null : (
        <Text style={s.empty}>无销售配置记录 · No sales fields recorded.</Text>
      )}

      {flags ? (
        <Text style={[s.empty, { marginTop: 2, color: COLORS.warnText }]}>
          例外 · Exceptions: {flags}
        </Text>
      ) : null}

      {/* m180 — the line's OWN factory programming (final values). Same rule
          engine as the task-list UI: not_applicable lines print nothing. */}
      {line.programming_requirement !== "not_applicable" &&
      line.lighting &&
      (line.lighting.final.program.length > 0 ||
        line.lighting.final.operating_hours != null ||
        line.lighting.final.dusk_to_dawn ||
        line.lighting.final.factory_instructions) ? (
        <View style={s.note} wrap={false}>
          <Text style={s.noteLabel}>本产品程序设定 · Programming (this line)</Text>
          <Text style={s.noteText}>
            {[
              line.lighting.final.operating_hours != null
                ? `每晚 ${line.lighting.final.operating_hours}h/night`
                : null,
              line.lighting.final.dusk_to_dawn ? "黄昏至黎明 · dusk-to-dawn" : null,
              line.lighting.final.autonomous ? "自主模式 · autonomous" : null,
              line.lighting.final.controller.type
                ? `控制器 controller: ${line.lighting.final.controller.type}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </Text>
          {line.lighting.final.program.map((p, i) => (
            <Text key={i} style={s.noteText}>
              {i + 1}. {p.duration_hours}h @ {p.output}%
              {p.presence_detection
                ? ` · 感应 PIR → ${p.detection_output ?? 100}%`
                : ""}
            </Text>
          ))}
          {line.lighting.final.factory_instructions ? (
            <Text style={s.noteText}>{line.lighting.final.factory_instructions}</Text>
          ) : null}
        </View>
      ) : null}

      {line.internal_notes ? (
        <View style={s.note}>
          <Text style={s.noteLabel}>产线备注 · Line notes</Text>
          <Text style={s.noteText}>{line.internal_notes}</Text>
        </View>
      ) : null}
    </View>
  );
}

/* --------------------------------- document -------------------------------- */

export default function ProductionDossierPDF({
  data,
  appendix,
}: {
  data: ExportData;
  appendix: AppendixItem[];
}) {
  const S = DOSSIER_SECTIONS;
  const generatedAt = fmtDate(new Date().toISOString());
  const statusZh = STATUS_ZH[data.status] ?? "";
  const statusEn = data.status.replace(/_/g, " ").toUpperCase();

  const industrial = data.industrial;
  const spec = industrial?.spec ?? null;
  const showIndustrial = !!(
    industrial &&
    (industrial.solar_panel_tilt_angle != null || spec)
  );
  const requiredStickers = data.stickers?.items.filter((i) => i.required) ?? [];
  const showLighting = !!(
    data.lighting &&
    (data.lighting.lighting_power ||
      data.lighting.operating_hours ||
      data.lighting.lighting_program.length > 0 ||
      data.lighting.approved_optics ||
      data.lighting.dialux_configurations.length > 0)
  );
  const showTransport = !!(data.logistics || data.shipping_method);
  const activeRisks = data.risks?.items.filter((i) => i.active) ?? [];
  const showFinishing =
    showIndustrial || requiredStickers.length > 0 || !!data.stickers?.notes;
  const spareParts = spec?.spare_parts ?? [];

  const runningTitle = `${S.dossier.zh} · Production Dossier · ${data.number}`;
  const runningRight = data.client.company_name;

  const footer = (
    <Text style={s.footer} fixed>
      {`SOLUX · ${S.dossier.zh} Production Dossier · ${data.number} · ${generatedAt} · 工厂唯一生产依据 · complete production package`}
    </Text>
  );

  return (
    <Document>
      <Page size="A4" style={[s.page, s.contentTop]} wrap>
        <View style={s.runHead} fixed>
          <Text style={s.runHeadL}>{runningTitle}</Text>
          <Text style={s.runHeadR}>{runningRight}</Text>
        </View>

        {/* ===================== MASTHEAD ===================== */}
        <BrandHeader />
        <View style={s.titleRow}>
          <View>
            <Text style={s.titleZh}>{S.dossier.zh}</Text>
            <Text style={s.titleEn}>
              Production Dossier · 工厂完整生产文件
            </Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={s.titleNum}>{data.number}</Text>
            <Text style={[s.titleEn, { marginTop: 1 }]}>
              {statusZh ? `${statusZh} · ` : ""}
              {statusEn}
            </Text>
          </View>
        </View>

        {/* Order identity band — everything the floor needs to place the job. */}
        <View style={s.band}>
          <View style={s.bandRow}>
            <View style={[s.bandCell, { flex: 3 }]}>
              <Text style={s.bandLabel}>客户 · Client</Text>
              <Text style={s.bandValue}>
                {data.client.company_name}
                {data.client.client_code ? ` · ${data.client.client_code}` : ""}
              </Text>
            </View>
            <View style={[s.bandCell, { flex: 1.4 }]}>
              <Text style={s.bandLabel}>国家 · Country</Text>
              <Text style={s.bandValue}>{data.client.country ?? "—"}</Text>
            </View>
            <View style={[s.bandCell, { flex: 2, borderRightWidth: 0 }]}>
              <Text style={s.bandLabel}>联系人 · Contact</Text>
              <Text style={s.bandValue}>{data.client.contact_name ?? "—"}</Text>
            </View>
          </View>
          <View style={s.bandRow}>
            <View style={[s.bandCell, { flex: 2 }]}>
              <Text style={s.bandLabel}>订单编号 · Order ref</Text>
              <Text style={s.bandValue}>{data.quotation_number ?? "—"}</Text>
            </View>
            <View style={[s.bandCell, { flex: 2 }]}>
              <Text style={s.bandLabel}>任务单 · Task list</Text>
              <Text style={s.bandValue}>{data.number}</Text>
            </View>
            <View style={[s.bandCell, { flex: 2, borderRightWidth: 0 }]}>
              <Text style={s.bandLabel}>运输 · Shipping</Text>
              <Text style={s.bandValue}>
                {data.shipping_method ?? data.logistics?.freight_type ?? "—"}
              </Text>
            </View>
          </View>
          <View style={s.bandRowLast}>
            <View style={[s.bandCell, { flex: 2 }]}>
              <Text style={s.bandLabel}>创建 · Created</Text>
              <Text style={s.bandValue}>
                {fmtDate(data.created_at)}
                {data.created_by_label ? ` · ${data.created_by_label}` : ""}
              </Text>
            </View>
            <View style={[s.bandCell, { flex: 2 }]}>
              <Text style={s.bandLabel}>审核 · Validated</Text>
              <Text style={s.bandValue}>
                {fmtDate(data.validated_at)}
                {data.validated_by_label ? ` · ${data.validated_by_label}` : ""}
              </Text>
            </View>
            <View style={[s.bandCell, { flex: 2, borderRightWidth: 0 }]}>
              <Text style={s.bandLabel}>生成 · Generated</Text>
              <Text style={s.bandValue}>{generatedAt}</Text>
            </View>
          </View>
        </View>

        {/* ===================== PRODUCTION NOTES (sales) ===================== */}
        {(data.original_sales_request || data.production_notes) && (
          <View wrap={false}>
            {data.original_sales_request ? (
              <View style={s.note}>
                <Text style={s.noteLabel}>客户原始需求 · Original sales request</Text>
                <Text style={s.noteText}>{data.original_sales_request}</Text>
              </View>
            ) : null}
            {data.production_notes ? (
              <View style={s.note}>
                <Text style={s.noteLabel}>生产说明 · Production notes</Text>
                <Text style={s.noteText}>{data.production_notes}</Text>
              </View>
            ) : null}
          </View>
        )}

        {/* ===================== BUILD SHEETS ===================== */}
        <Section
          zh="生产任务"
          en="Production Build Sheet"
          note={`${data.lines.length} 项 · items`}
        />
        {data.lines.length === 0 ? (
          <Text style={s.empty}>无产品行 · No line items.</Text>
        ) : (
          data.lines.map((l, i) => (
            <Fragment key={i}>
              <LineBuild line={l} />
            </Fragment>
          ))
        )}

        {/* ===================== FINISHING (industrial · packaging · manual · stickers) ===================== */}
        {showFinishing && (
          <>
            <Section zh="装配与包装" en="Finishing · Packaging · Manual · Stickers" />

            {/* Tilt angle — critical, inline highlighted row. */}
            {showIndustrial && industrial!.solar_panel_tilt_angle != null && (
              <View
                style={[
                  s.tRow,
                  { borderBottomWidth: 0, paddingHorizontal: 0, alignItems: "center" },
                ]}
                wrap={false}
              >
                <Text style={[s.tdStrong, { width: 150 }]}>
                  太阳能板倾角 · Tilt angle
                </Text>
                <Text style={[s.chipCell, { marginRight: 8 }]}>
                  {formatTiltAngle(industrial!.solar_panel_tilt_angle)}
                </Text>
                {industrial!.pole_drawing_tilt_verified ? (
                  <Text style={s.td}>
                    ✓ 灯杆图纸已核对 · Pole drawing checked
                    {industrial!.pole_drawing_tilt_verified_at
                      ? ` (${fmtDate(industrial!.pole_drawing_tilt_verified_at)})`
                      : ""}
                  </Text>
                ) : (
                  <Text style={s.tdMissing}>
                    ⚠ 图纸未核对 · Pole drawing NOT checked — confirm before production.
                  </Text>
                )}
              </View>
            )}

            {/* Packaging / manual / accessories — dense KV strip. */}
            <View style={s.kvWrap}>
              {spec?.packaging.version ? (
                <KV
                  zh="包装"
                  en="Packaging"
                  value={`${PACKAGING_VERSION_TITLES[spec.packaging.version].zh} · ${PACKAGING_VERSION_TITLES[spec.packaging.version].en}`}
                />
              ) : null}
              {spec?.user_manual.brand ? (
                <KV
                  zh="手册"
                  en="Manual"
                  value={`${MANUAL_BRAND_TITLES[spec.user_manual.brand].zh}${
                    spec.user_manual.languages.length
                      ? " · " +
                        spec.user_manual.languages
                          .map((l) => MANUAL_LANGUAGE_TITLES[l].en)
                          .join(", ")
                      : ""
                  }`}
                />
              ) : null}
              {spec && spec.pole_accessories.items.length > 0 ? (
                <KV
                  zh="灯杆配件"
                  en="Pole accessories"
                  value={spec.pole_accessories.items
                    .map((it) => `${it.label} ${it.included ? "✓" : "✗ EXCL"}`)
                    .join(" · ")}
                />
              ) : null}
            </View>

            {/* Stickers — compact table. */}
            {requiredStickers.length > 0 && (
              <View style={{ marginTop: 4 }}>
                <View style={s.tHead} fixed>
                  <Text style={[s.th, { flex: 2 }]}>标签 · Sticker</Text>
                  <Text style={[s.th, { flex: 1.3 }]}>工艺 · Method</Text>
                  <Text style={[s.th, { flex: 1.3 }]}>品牌 · Branding</Text>
                  <Text style={[s.th, { flex: 2.2 }]}>位置 · Position</Text>
                  <Text style={[s.th, { flex: 2.4 }]}>备注 · Note</Text>
                </View>
                {requiredStickers.map((it, i) => (
                  <View
                    key={i}
                    style={i % 2 === 1 ? [s.tRow, s.tRowAlt] : s.tRow}
                    wrap={false}
                  >
                    <Text style={[s.tdStrong, { flex: 2, paddingRight: 4 }]}>
                      {it.label}
                    </Text>
                    <Text style={[s.td, { flex: 1.3 }]}>
                      {it.method === "laser"
                        ? "激光 Laser"
                        : it.method === "sticker"
                        ? "贴纸 Sticker"
                        : "—"}
                    </Text>
                    <Text style={[s.td, { flex: 1.3 }]}>
                      {it.branding_source === "solux"
                        ? "Solux"
                        : it.branding_source === "customer"
                        ? "客户 Customer"
                        : "—"}
                    </Text>
                    <Text style={[s.td, { flex: 2.2 }]}>{it.positioning ?? "—"}</Text>
                    <Text style={[s.td, { flex: 2.4 }]}>{it.note ?? "—"}</Text>
                  </View>
                ))}
              </View>
            )}
            {data.stickers?.notes ? (
              <View style={s.note}>
                <Text style={s.noteLabel}>标签备注 · Sticker notes</Text>
                <Text style={s.noteText}>{data.stickers.notes}</Text>
              </View>
            ) : null}
            {(requiredStickers.length > 0 ||
              spec?.packaging.version === "custom_client" ||
              spec?.user_manual.brand === "custom") && (
              <Text style={s.empty}>
                图稿文件（如已上传）见附录 · Artwork files, if uploaded, are in the Appendix.
              </Text>
            )}
          </>
        )}

        {/* ===================== LIGHTING PROGRAM ===================== */}
        {showLighting && data.lighting && (
          <>
            <Section zh="灯光程序" en="Lighting Program · Setting" />
            <View style={s.kvWrap}>
              <KV
                zh="额定功率"
                en="Power"
                value={
                  data.lighting.lighting_power != null
                    ? `${data.lighting.lighting_power} W`
                    : "—"
                }
                cols={3}
              />
              <KV
                zh="每晚时长"
                en="Hours"
                value={
                  data.lighting.operating_hours != null
                    ? `${data.lighting.operating_hours} h`
                    : "—"
                }
                cols={3}
              />
              <KV
                zh="配光透镜"
                en="Optics"
                value={data.lighting.approved_optics ?? "—"}
                cols={3}
              />
            </View>

            {data.lighting.lighting_program.length > 0 && (
              <View style={{ marginTop: 3 }}>
                <View style={s.tHead} fixed>
                  <Text style={[s.th, { width: 60 }]}>时段 · Period</Text>
                  <Text style={[s.th, { width: 60, textAlign: "right" }]}>
                    输出 · Output
                  </Text>
                  <Text style={[s.th, { width: 66, textAlign: "right" }]}>
                    时长 · Duration
                  </Text>
                  <Text style={[s.th, { flex: 1, paddingLeft: 10 }]}>
                    感应模式 · Motion sensor
                  </Text>
                </View>
                {data.lighting.lighting_program.map((p, i) => (
                  <View
                    key={i}
                    style={i % 2 === 1 ? [s.tRow, s.tRowAlt] : s.tRow}
                    wrap={false}
                  >
                    <Text style={[s.tdStrong, { width: 60 }]}>P{i + 1}</Text>
                    <Text style={[s.tdSpec, { width: 60, textAlign: "right" }]}>
                      {p.output}%
                    </Text>
                    <Text style={[s.td, { width: 66, textAlign: "right" }]}>
                      {p.duration_hours} h
                    </Text>
                    <Text style={[s.td, { flex: 1, paddingLeft: 10 }]}>
                      {p.presence_detection
                        ? `感应加亮至 ${p.detection_output ?? "—"}% · boost to ${
                            p.detection_output ?? "—"
                          }%${
                            p.detection_hold_seconds
                              ? `, hold ${p.detection_hold_seconds}s`
                              : ""
                          }`
                        : "固定输出 · Fixed level"}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {data.lighting.dialux_configurations.length > 0 && (
              <View style={{ marginTop: 3 }}>
                <View style={s.tHead} fixed>
                  <Text style={[s.th, { flex: 2 }]}>区域 · Zone</Text>
                  <Text style={[s.th, { width: 42, textAlign: "right" }]}>W</Text>
                  <Text style={[s.th, { width: 48, textAlign: "right" }]}>
                    H (m)
                  </Text>
                  <Text style={[s.th, { flex: 1.6, paddingLeft: 8 }]}>
                    光学 · Optic
                  </Text>
                  <Text style={[s.th, { width: 48, textAlign: "right" }]}>
                    色温 CCT
                  </Text>
                  <Text style={[s.th, { width: 38, textAlign: "right" }]}>
                    数量 Qty
                  </Text>
                </View>
                {data.lighting.dialux_configurations.map((c, i) => (
                  <View
                    key={i}
                    style={i % 2 === 1 ? [s.tRow, s.tRowAlt] : s.tRow}
                    wrap={false}
                  >
                    <Text style={[s.td, { flex: 2 }]}>
                      {c.label ?? `Config ${i + 1}`}
                    </Text>
                    <Text style={[s.td, { width: 42, textAlign: "right" }]}>
                      {c.power ?? "—"}
                    </Text>
                    <Text style={[s.td, { width: 48, textAlign: "right" }]}>
                      {c.mounting_height ?? "—"}
                    </Text>
                    <Text style={[s.td, { flex: 1.6, paddingLeft: 8 }]}>
                      {[c.optic_code, c.optic_beam_distribution]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </Text>
                    <Text style={[s.td, { width: 48, textAlign: "right" }]}>
                      {c.cct ? `${c.cct}K` : "—"}
                    </Text>
                    <Text style={[s.td, { width: 38, textAlign: "right" }]}>
                      {c.quantity ?? "—"}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {(data.lighting.energy_study_name || data.lighting.dialux_name) && (
              <Text style={[s.empty, { marginTop: 3 }]}>
                能耗报告 / DIALux 报告见附录 · Energy study & DIALux report in the Appendix.
              </Text>
            )}
          </>
        )}

        {/* ===================== SPARE PARTS ===================== */}
        {spareParts.length > 0 && (
          <>
            <Section zh="备品备件" en="Free Spare Parts" />
            <View>
              <View style={s.tHead} fixed>
                <Text style={[s.th, { width: 22 }]}>No</Text>
                <Text style={[s.th, { flex: 3 }]}>部件 · Part</Text>
                <Text style={[s.th, { flex: 2 }]}>型号 · Model</Text>
                <Text style={[s.th, { width: 34, textAlign: "right" }]}>
                  数量 Qty
                </Text>
                <Text style={[s.th, { flex: 2.4, paddingLeft: 12 }]}>
                  备注 · Notes
                </Text>
              </View>
              {spareParts.map((p, i) => (
                <View
                  key={i}
                  style={i % 2 === 1 ? [s.tRow, s.tRowAlt] : s.tRow}
                  wrap={false}
                >
                  <Text style={[s.td, { width: 22 }]}>{i + 1}</Text>
                  <View style={{ flex: 3, paddingRight: 4 }}>
                    <Text style={s.tdStrong}>{p.part || "—"}</Text>
                    {p.factory_name_cn || p.factory_name ? (
                      <Text style={[s.td, { fontSize: 7, color: COLORS.muted }]}>
                        {p.factory_name_cn || p.factory_name}
                        {p.erp_code ? ` · ERP ${p.erp_code}` : ""}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={[s.td, { flex: 2, paddingRight: 4 }]}>
                    {p.model ?? "—"}
                  </Text>
                  <Text style={[s.tdStrong, { width: 34, textAlign: "right" }]}>
                    × {p.quantity}
                  </Text>
                  <Text style={[s.td, { flex: 2.4, paddingLeft: 12 }]}>
                    {p.notes ?? "—"}
                  </Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* ===================== TRANSPORT + DOCUMENTS (side by side row) ===================== */}
        {showTransport && (
          <>
            <Section zh="运输信息" en="Transport" />
            <View style={s.kvWrap}>
              <KV zh="贸易条款" en="Incoterm" value={data.logistics?.incoterm ?? "—"} cols={3} />
              <KV
                zh="运输方式"
                en="Method"
                value={data.shipping_method ?? data.logistics?.freight_type ?? "—"}
                cols={3}
              />
              <KV
                zh="生产周期"
                en="Prod. time"
                value={
                  data.logistics?.production_days != null
                    ? `${data.logistics.production_days} days`
                    : data.logistics?.production_date
                    ? fmtDate(data.logistics.production_date)
                    : "—"
                }
                cols={3}
              />
              <KV
                zh="装运港"
                en="Loading port"
                value={data.logistics?.port_of_loading ?? "—"}
              />
              <KV
                zh="目的港"
                en="Destination port"
                value={data.logistics?.port_of_destination ?? "—"}
              />
            </View>
          </>
        )}

        {/* ===================== QUALITY / RISKS ===================== */}
        {(activeRisks.length > 0 || data.risks?.notes) && (
          <>
            <Section zh="质量控制" en="Quality Control · Risks" />
            {activeRisks.map((r, i) => (
              <View key={i} style={[s.note, s.noteWarn]} wrap={false}>
                <Text style={s.noteLabel}>⚠ {r.label}</Text>
                {r.note ? <Text style={s.noteText}>{r.note}</Text> : null}
              </View>
            ))}
            {data.risks?.notes ? (
              <View style={[s.note, s.noteWarn]}>
                <Text style={s.noteLabel}>质量与风险备注 · Quality & risk notes</Text>
                <Text style={s.noteText}>{data.risks.notes}</Text>
              </View>
            ) : null}
          </>
        )}

        {/* ===================== INTERNAL NOTES ===================== */}
        {data.technical_notes && (
          <>
            <Section zh="内部备注" en="Internal Notes" />
            <View style={[s.note, s.noteWarn]}>
              <Text style={s.noteText}>{data.technical_notes}</Text>
            </View>
          </>
        )}

        {/* ===================== DOCUMENTS / APPENDIX INDEX ===================== */}
        <Section zh="上传文件 · 附录" en="Uploaded Documents · Appendix" />
        {appendix.length === 0 ? (
          <Text style={s.empty}>
            本项目无上传文件 · No documents uploaded for this project.
          </Text>
        ) : (
          <View>
            <View style={s.tHead} fixed>
              <Text style={[s.th, { width: 30 }]}>编号 Ref</Text>
              <Text style={[s.th, { flex: 4 }]}>文件 · File</Text>
              <Text style={[s.th, { flex: 2 }]}>类型 · Type</Text>
              <Text style={[s.th, { flex: 2.4 }]}>状态 · Status</Text>
            </View>
            {appendix.map((a, i) => (
              <View
                key={i}
                style={i % 2 === 1 ? [s.tRow, s.tRowAlt] : s.tRow}
                wrap={false}
              >
                <Text style={[s.tdStrong, { width: 30 }]}>{a.label ?? "—"}</Text>
                <Text style={[s.td, { flex: 4, paddingRight: 4 }]}>
                  {a.file_name}
                </Text>
                <Text style={[s.td, { flex: 2 }]}>{a.type_label}</Text>
                <Text style={[s.td, { flex: 2.4 }]}>
                  {a.label
                    ? "已合并至附录 · In appendix"
                    : "另行提供 · Provided separately"}
                </Text>
              </View>
            ))}
          </View>
        )}

        {footer}
      </Page>
    </Document>
  );
}
