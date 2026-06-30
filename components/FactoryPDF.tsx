"use client";

import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { ExportData } from "@/app/(app)/task-lists/[id]/exportData";
// Shared SOLUX document design system — same grid, palette, fonts, masthead
// and title pattern as the quotation / invoice / proforma PDFs, so the
// factory release reads as part of one coherent document ecosystem.
import {
  BrandHeader,
  DocTitle,
  Rule,
  SectionHeader,
  COLORS,
  F,
  M_OUT,
  GAP_M,
} from "@/components/pdf/theme";

/**
 * Factory task list PDF — the internal production-release document.
 *
 * Visual identity is unified with the customer-facing documents (Armin
 * Grotesk body, Akzidenz Extended titles, 1.2 cm grid, SLX-gray hair-lines).
 * Only the *content* differs: a dense order grid, an order-summary table,
 * and per-line instruction cards that surface the resolved factory mapping
 * with explicit OVERRIDDEN / MISSING status (the one place we allow the
 * restrained warn/danger tints from the shared palette).
 *
 * Layout strategy: vertical "field card" stack so long factory instructions
 * wrap freely across the full content width. Each card is `wrap={false}` so
 * it stays atomic across page breaks.
 */

const s = StyleSheet.create({
  page: {
    paddingTop: M_OUT,
    paddingBottom: M_OUT + 18, // room for the fixed footer
    paddingHorizontal: M_OUT,
    fontFamily: F.body,
    fontWeight: 200,
    fontSize: 8,
    color: COLORS.body,
    lineHeight: 1.45,
  },

  /* ----- Order meta grid (Client / Country / Order ref / …) ----- */
  metaGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 2,
  },
  metaCell: { width: "33.33%", marginBottom: 8, paddingRight: 10 },
  metaLabel: {
    fontSize: 7,
    fontWeight: 400,
    color: COLORS.muted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 1,
  },
  metaValue: { fontSize: 9, fontWeight: 400, color: COLORS.ink },

  /* ----- Order summary table (mirrors the quotation table styling) ----- */
  table: { marginTop: 2, marginBottom: GAP_M },
  tableHead: {
    flexDirection: "row",
    backgroundColor: COLORS.hair,
    paddingVertical: 6,
    paddingHorizontal: 6,
  },
  tableHeadCell: {
    fontSize: 8,
    fontWeight: 600,
    color: COLORS.ink,
    textTransform: "uppercase",
    letterSpacing: 0.2,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 5,
    paddingHorizontal: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.hair,
  },
  tableRowAlt: { backgroundColor: COLORS.fill },
  colProduct: { flex: 3, paddingRight: 8 },
  colCategory: { flex: 2, paddingRight: 8 },
  colQty: { width: 40, textAlign: "right", paddingRight: 8 },
  colConfig: { flex: 4 },
  cellProduct: { fontSize: 8.5, fontWeight: 600, color: COLORS.ink },
  cellSku: { fontSize: 7.5, fontWeight: 200, color: COLORS.muted },
  cellText: { fontSize: 8, fontWeight: 200, color: COLORS.body },
  cellQty: { fontSize: 9, fontWeight: 600, color: COLORS.ink },

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
  notesLabel: {
    fontSize: 7,
    fontWeight: 400,
    color: COLORS.muted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 3,
  },
  notesText: { fontSize: 8.5, fontWeight: 200, color: COLORS.body },

  /* ----- Per-line block ----- */
  lineBlock: { marginBottom: 14 },
  lineHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    backgroundColor: COLORS.fill,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.ink,
    paddingVertical: 6,
    paddingHorizontal: 8,
    marginBottom: 8,
  },
  lineHeaderLeft: { flex: 1, paddingRight: 8 },
  lineProductName: {
    fontSize: 11,
    fontWeight: 600,
    color: COLORS.ink,
    letterSpacing: 0.3,
  },
  lineMeta: { fontSize: 7.5, fontWeight: 200, color: COLORS.muted, marginTop: 1 },
  lineHeaderRight: { alignItems: "flex-end" },
  lineQtyLabel: {
    fontSize: 7,
    fontWeight: 400,
    color: COLORS.muted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  lineQtyValue: { fontSize: 13, fontWeight: 900, color: COLORS.ink },

  /* ----- Field card ----- */
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
  fieldName: { fontSize: 9, fontWeight: 600, color: COLORS.ink, marginRight: 8 },
  salesPill: {
    fontSize: 8,
    fontWeight: 400,
    color: COLORS.ink,
    backgroundColor: COLORS.fill,
    borderWidth: 0.5,
    borderColor: COLORS.hair,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  badgeOverride: {
    fontSize: 7,
    fontWeight: 600,
    color: COLORS.warnText,
    borderWidth: 0.5,
    borderColor: COLORS.warnBorder,
    paddingHorizontal: 5,
    paddingVertical: 1,
    marginLeft: 6,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  badgeMissing: {
    fontSize: 7,
    fontWeight: 600,
    color: COLORS.dangerText,
    borderWidth: 0.5,
    borderColor: COLORS.dangerBorder,
    paddingHorizontal: 5,
    paddingVertical: 1,
    marginLeft: 6,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  factoryCodeRow: {
    fontSize: 8,
    fontWeight: 200,
    color: COLORS.muted,
    marginBottom: 2,
  },
  instructionLabel: {
    fontSize: 7,
    fontWeight: 400,
    color: COLORS.muted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginTop: 3,
    marginBottom: 1,
  },
  instructionText: { fontSize: 9, fontWeight: 200, color: COLORS.ink, lineHeight: 1.5 },
  instructionMuted: {
    fontSize: 9,
    fontWeight: 200,
    color: COLORS.dangerText,
    fontStyle: "italic",
    lineHeight: 1.5,
  },
  mappingText: {
    fontSize: 8,
    fontWeight: 200,
    color: COLORS.muted,
    fontStyle: "italic",
    lineHeight: 1.45,
  },

  /* ----- Technical refs sub-block ----- */
  techSubBlock: {
    marginTop: 2,
    padding: 8,
    backgroundColor: COLORS.fill,
    borderWidth: 0.5,
    borderColor: COLORS.hair,
  },
  techGrid: { flexDirection: "row", flexWrap: "wrap" },
  techCell: { width: "50%", marginBottom: 4, paddingRight: 6 },
  techLabel: {
    fontSize: 7,
    fontWeight: 400,
    color: COLORS.muted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  techValue: { fontSize: 8.5, fontWeight: 200, color: COLORS.ink, marginTop: 1 },

  /* ----- Internal notes ----- */
  internalNotes: {
    marginTop: 6,
    padding: 8,
    borderWidth: 0.5,
    borderColor: COLORS.hair,
  },

  /* ----- Footer ----- */
  footer: {
    position: "absolute",
    bottom: 18,
    left: M_OUT,
    right: M_OUT,
    fontSize: 7,
    fontWeight: 200,
    color: COLORS.muted,
    textAlign: "center",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    borderTopWidth: 0.5,
    borderTopColor: COLORS.hair,
    paddingTop: 5,
  },

  emptyNote: { fontSize: 8, fontWeight: 200, color: COLORS.muted },
});

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB");
}

function MetaCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.metaCell}>
      <Text style={s.metaLabel}>{label}</Text>
      <Text style={s.metaValue}>{value || "—"}</Text>
    </View>
  );
}

export default function FactoryPDF({ data }: { data: ExportData }) {
  return (
    <Document>
      <Page size="A4" style={s.page} wrap>
        {/* ---------- MASTHEAD (shared brand header) ---------- */}
        <BrandHeader />

        {/* ---------- TITLE ---------- */}
        <DocTitle
          title="Factory Task List"
          reference={data.number}
          caption="Internal production document · not for customer"
        />

        <Rule />

        {/* ---------- PROJECT (affair name) — prominent, so the factory
            knows WHICH project at a glance, not just a number. ---------- */}
        {data.affair_name ? (
          <View style={{ marginBottom: 10 }}>
            <Text
              style={{
                fontSize: 7,
                fontWeight: 400,
                color: COLORS.muted,
                textTransform: "uppercase",
                letterSpacing: 0.8,
              }}
            >
              Project
            </Text>
            <Text style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink }}>
              {data.affair_name}
            </Text>
          </View>
        ) : null}

        {/* ---------- ORDER META GRID ---------- */}
        <View style={s.metaGrid}>
          <MetaCell
            label="Client"
            value={
              data.client.company_name +
              (data.client.client_code ? ` · ${data.client.client_code}` : "")
            }
          />
          <MetaCell label="Country" value={data.client.country ?? "—"} />
          <MetaCell
            label="Order reference"
            value={data.quotation_number ?? "—"}
          />
          <MetaCell label="Created" value={fmtDate(data.created_at)} />
          <MetaCell label="Status" value={data.status.toUpperCase()} />
          <MetaCell label="Shipping" value={data.shipping_method ?? "—"} />
          <MetaCell label="Created by" value={data.created_by_label} />
          <MetaCell label="Reviewed by" value={data.validated_by_label} />
        </View>

        {/* ---------- ORDER SUMMARY ---------- */}
        <SectionHeader>Order summary</SectionHeader>
        <View style={s.table}>
          <View style={s.tableHead} fixed>
            <Text style={[s.tableHeadCell, s.colProduct]}>Product / Model</Text>
            <Text style={[s.tableHeadCell, s.colCategory]}>Category</Text>
            <Text style={[s.tableHeadCell, s.colQty]}>Qty</Text>
            <Text style={[s.tableHeadCell, s.colConfig]}>Main configuration</Text>
          </View>
          {data.lines.length === 0 ? (
            <View style={s.tableRow}>
              <Text style={s.emptyNote}>No line items.</Text>
            </View>
          ) : (
            data.lines.map((l, i) => (
              <View
                key={i}
                style={i % 2 === 1 ? [s.tableRow, s.tableRowAlt] : s.tableRow}
                wrap={false}
              >
                <View style={s.colProduct}>
                  <Text style={s.cellProduct}>{l.product_name}</Text>
                  {l.product_sku && (
                    <Text style={s.cellSku}>{l.product_sku}</Text>
                  )}
                </View>
                <Text style={[s.cellText, s.colCategory]}>
                  {l.product_category ?? "—"}
                </Text>
                <Text style={[s.cellQty, s.colQty]}>× {l.quantity}</Text>
                <Text style={[s.cellText, s.colConfig]}>
                  {l.config_summary || "—"}
                </Text>
              </View>
            ))
          )}
        </View>

        {/* ---------- TOP-LEVEL NOTES ---------- */}
        {data.production_notes && (
          <View style={s.notesBlock} wrap={false}>
            <Text style={s.notesLabel}>Production notes (from sales)</Text>
            <Text style={s.notesText}>{data.production_notes}</Text>
          </View>
        )}
        {data.technical_notes && (
          <View style={s.notesBlockWarn} wrap={false}>
            <Text style={s.notesLabel}>Technical notes (internal)</Text>
            <Text style={s.notesText}>{data.technical_notes}</Text>
          </View>
        )}

        {/* ---------- PER-LINE FACTORY DETAIL ---------- */}
        <SectionHeader>Factory task list</SectionHeader>
        {data.lines.map((l, i) => (
          <View key={i} style={s.lineBlock}>
            <View style={s.lineHeader} minPresenceAhead={80}>
              <View style={s.lineHeaderLeft}>
                <Text style={s.lineProductName}>{l.product_name}</Text>
                <Text style={s.lineMeta}>
                  {l.product_sku ?? "—"}
                  {l.product_category ? ` · ${l.product_category}` : ""}
                </Text>
              </View>
              <View style={s.lineHeaderRight}>
                <Text style={s.lineQtyLabel}>Quantity</Text>
                <Text style={s.lineQtyValue}>× {l.quantity}</Text>
              </View>
            </View>

            {/* m135 — manual item (pole/mast/non-catalog): free-text specs in
                place of the catalog configurator. */}
            {l.is_manual && l.manual_specs && (
              <View style={s.fieldCard} wrap={false}>
                <Text style={s.notesLabel}>Specifications</Text>
                <Text style={s.notesText}>{l.manual_specs}</Text>
              </View>
            )}

            {l.rows.length === 0 ? (
              <View style={s.fieldCard} wrap={false}>
                <Text style={s.emptyNote}>
                  {l.is_manual
                    ? "Manual item — no catalog configuration."
                    : "No sales fields recorded for this line."}
                </Text>
              </View>
            ) : (
              l.rows.map((r, j) => {
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
                      {r.note === "OVERRIDDEN" && (
                        <Text style={s.badgeOverride}>Overridden</Text>
                      )}
                      {r.note === "MISSING" && (
                        <Text style={s.badgeMissing}>Missing</Text>
                      )}
                    </View>

                    {r.factory_code && (
                      <Text style={s.factoryCodeRow}>
                        Factory code: {r.factory_code}
                      </Text>
                    )}

                    <Text style={s.instructionLabel}>
                      Final factory instruction
                    </Text>
                    {r.source === "missing" ? (
                      <Text style={s.instructionMuted}>
                        Missing factory mapping — add it in Admin → Factory
                        mapping, or provide a one-off override on the line.
                      </Text>
                    ) : (
                      <Text style={s.instructionText}>
                        {r.final_factory_instruction || "—"}
                      </Text>
                    )}

                    {r.source === "override" &&
                      r.factory_mapping_instruction && (
                        <>
                          <Text style={s.instructionLabel}>
                            Standard mapping (replaced by override)
                          </Text>
                          <Text style={s.mappingText}>
                            {r.factory_mapping_instruction}
                          </Text>
                        </>
                      )}

                    {r.note &&
                      r.note !== "OVERRIDDEN" &&
                      r.note !== "MISSING" && (
                        <>
                          <Text style={s.instructionLabel}>Notes</Text>
                          <Text style={s.instructionText}>{r.note}</Text>
                        </>
                      )}
                  </View>
                );
              })
            )}

            {l.technical_entries.length > 0 && (
              <View style={s.techSubBlock} wrap={false}>
                <Text style={s.notesLabel}>Technical references (internal)</Text>
                <View style={s.techGrid}>
                  {l.technical_entries.map((e, j) => (
                    <View key={j} style={s.techCell}>
                      <Text style={s.techLabel}>{e.label}</Text>
                      <Text style={s.techValue}>{e.value}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {l.internal_notes && (
              <View style={s.internalNotes} wrap={false}>
                <Text style={s.notesLabel}>Internal notes</Text>
                <Text style={s.notesText}>{l.internal_notes}</Text>
              </View>
            )}
          </View>
        ))}

        <Text
          style={s.footer}
          fixed
          render={({ pageNumber, totalPages }) =>
            `SOLUX · Factory task list ${data.number} · Internal · ${fmtDate(
              new Date().toISOString()
            )} · Page ${pageNumber} of ${totalPages}`
          }
        />
      </Page>
    </Document>
  );
}
