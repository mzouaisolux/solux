// =====================================================================
// lib/packing-export.ts — build a professional packing list as an Excel
// workbook (exceljs) from an engine result + metadata. The generated file
// retains a snapshot of the packaging-data versions used (§18).
// =====================================================================
import ExcelJS from "exceljs";
import { CALC_METHOD_LABEL, CALC_METHOD_CAUTION, type PackingResult } from "@/lib/packing-core/index.ts";

export interface PackingMeta {
  reference?: string;
  customer?: string;
  project?: string;
  destination?: string;
  incoterm?: string;
  validated_by?: string;
  validated_at?: string;
}

const dims = (d: { l_mm: number | null; w_mm: number | null; h_mm: number | null }) =>
  d.l_mm == null && d.w_mm == null && d.h_mm == null
    ? "—"
    : `${d.l_mm ?? "?"}×${d.w_mm ?? "?"}×${d.h_mm ?? "?"}`;

export async function buildPackingListExcel(
  result: PackingResult,
  meta: PackingMeta
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Packing Module (Phase 1)";
  const ws = wb.addWorksheet("Packing List");

  const title = (t: string) => {
    const r = ws.addRow([t]);
    r.font = { bold: true, size: 13 };
    ws.addRow([]);
  };
  const kv = (k: string, v: any) => {
    const r = ws.addRow([k, v ?? "—"]);
    r.getCell(1).font = { bold: true };
  };

  title("PACKING LIST");
  kv("Reference", meta.reference);
  kv("Customer", meta.customer);
  kv("Project", meta.project);
  kv("Destination", meta.destination);
  kv("Incoterm", meta.incoterm);
  const rec = result.container_recommendations.find((r) => r.recommended);
  kv("Recommended container", rec ? `${rec.count} × ${rec.container_code} (${rec.utilization_pct ?? "—"}% volume)` : "—");
  kv("Calculation method", CALC_METHOD_LABEL[result.calculation_method]);
  kv("Method caution", CALC_METHOD_CAUTION[result.calculation_method]);
  kv("Status", "Auto-calculated — Operations review required");
  ws.addRow([]);

  // Package table
  const head = ws.addRow([
    "Product ref", "Description", "Packaging method", "Package kind",
    "Packages", "Dimensions (mm)", "CBM each", "CBM total", "Net (kg)", "Gross (kg)", "Incomplete",
  ]);
  head.font = { bold: true };
  head.eachCell((c) => (c.border = { bottom: { style: "thin" } }));

  for (const p of result.packages) {
    ws.addRow([
      p.reference ?? "", p.name ?? "", p.packaging_method ?? "", p.package_kind,
      p.count, dims(p.dimensions_mm),
      p.cbm_each ?? "—", p.cbm_total ?? "—",
      p.net_weight ?? "—", p.gross_weight ?? "—",
      p.incomplete ? "yes" : "",
    ]);
  }

  ws.addRow([]);
  const tot = ws.addRow([
    "TOTALS", "", "", "",
    result.total_packages, "", "", result.total_cbm,
    result.net_weight, result.gross_weight, "",
  ]);
  tot.font = { bold: true };

  // Poles / oversized
  const poles = result.packages.filter((p) => p.is_pole || p.is_oversized);
  if (poles.length) {
    ws.addRow([]);
    const h = ws.addRow(["POLES / OVERSIZED — wooden case & Operations review"]);
    h.font = { bold: true, color: { argb: "FFB45309" } };
    for (const p of poles) ws.addRow([p.reference ?? "", `${p.count} pcs`, dims(p.dimensions_mm), ...(p.notes ?? [])]);
  }

  // Warnings + assumptions
  if (result.warnings.length) {
    ws.addRow([]);
    ws.addRow(["WARNINGS"]).font = { bold: true };
    for (const w of result.warnings) ws.addRow([w]);
  }
  if (result.assumptions.length) {
    ws.addRow([]);
    ws.addRow(["ASSUMPTIONS"]).font = { bold: true };
    for (const a of result.assumptions) ws.addRow([a]);
  }

  // Packaging versions snapshot
  ws.addRow([]);
  ws.addRow(["PACKAGING DATA VERSIONS USED (snapshot)"]).font = { bold: true };
  ws.addRow(["Item ref", "Version", "Item id"]).font = { bold: true };
  for (const v of result.packaging_versions_used)
    ws.addRow([v.reference ?? "", v.version_no ?? "", v.item_id]);

  // Widths
  ws.columns.forEach((c) => (c.width = 18));
  ws.getColumn(2).width = 28;
  ws.getColumn(6).width = 18;

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}
