// =====================================================================
// components/packing/PackingListPdf.tsx — PDF packing list via @react-pdf.
// Exposes renderPackingPdf() so the (.ts) export route stays JSX-free.
// =====================================================================
import { Document, Page, View, Text, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { CALC_METHOD_LABEL, CALC_METHOD_CAUTION, type PackingResult } from "@/lib/packing-core/index.ts";
import type { PackingMeta } from "@/lib/packing-export.ts";

const s = StyleSheet.create({
  page: { padding: 28, fontSize: 8, fontFamily: "Helvetica", color: "#1a1a1a" },
  h1: { fontSize: 15, fontFamily: "Helvetica-Bold", marginBottom: 6 },
  badge: { fontSize: 8, color: "#b45309", marginBottom: 10 },
  metaRow: { flexDirection: "row", marginBottom: 2 },
  metaK: { width: 110, fontFamily: "Helvetica-Bold" },
  th: { flexDirection: "row", borderBottom: 1, borderColor: "#333", paddingBottom: 3, marginTop: 8, fontFamily: "Helvetica-Bold" },
  tr: { flexDirection: "row", paddingVertical: 2, borderBottom: 0.5, borderColor: "#e5e5e5" },
  totals: { flexDirection: "row", paddingVertical: 3, marginTop: 2, fontFamily: "Helvetica-Bold" },
  sectionH: { fontFamily: "Helvetica-Bold", marginTop: 10, marginBottom: 2 },
  warn: { color: "#b45309", marginBottom: 1 },
});

const cols = [
  { k: "ref", w: 90, label: "Product ref" },
  { k: "method", w: 70, label: "Method" },
  { k: "kind", w: 70, label: "Kind" },
  { k: "count", w: 40, label: "Pkgs", n: true },
  { k: "dims", w: 90, label: "Dims (mm)" },
  { k: "cbm", w: 45, label: "CBM", n: true },
  { k: "net", w: 40, label: "Net", n: true },
  { k: "gross", w: 40, label: "Gross", n: true },
];

const d = (x: any) => (x == null ? "—" : String(x));
const dim = (o: any) => (o.l_mm == null && o.w_mm == null && o.h_mm == null ? "—" : `${o.l_mm ?? "?"}×${o.w_mm ?? "?"}×${o.h_mm ?? "?"}`);

function PackingDoc({ result, meta }: { result: PackingResult; meta: PackingMeta }) {
  const rec = result.container_recommendations.find((r) => r.recommended);
  const metaRows: [string, any][] = [
    ["Reference", meta.reference], ["Customer", meta.customer], ["Project", meta.project],
    ["Destination", meta.destination], ["Incoterm", meta.incoterm],
    ["Recommended", rec ? `${rec.count} × ${rec.container_code} (${rec.utilization_pct ?? "—"}% volume)` : "—"],
  ];
  return (
    <Document>
      <Page size="A4" style={s.page}>
        <Text style={s.h1}>PACKING LIST</Text>
        <Text style={s.badge}>{CALC_METHOD_LABEL[result.calculation_method]} — {CALC_METHOD_CAUTION[result.calculation_method]}</Text>

        {metaRows.map(([k, v]) => (
          <View style={s.metaRow} key={k}>
            <Text style={s.metaK}>{k}</Text>
            <Text>{d(v)}</Text>
          </View>
        ))}

        <View style={s.th}>
          {cols.map((c) => (
            <Text key={c.k} style={{ width: c.w, textAlign: c.n ? "right" : "left" }}>{c.label}</Text>
          ))}
        </View>
        {result.packages.map((p, i) => (
          <View style={s.tr} key={i}>
            <Text style={{ width: 90 }}>{d(p.reference)}</Text>
            <Text style={{ width: 70 }}>{d(p.packaging_method)}</Text>
            <Text style={{ width: 70 }}>{p.package_kind}</Text>
            <Text style={{ width: 40, textAlign: "right" }}>{p.count}</Text>
            <Text style={{ width: 90 }}>{dim(p.dimensions_mm)}</Text>
            <Text style={{ width: 45, textAlign: "right" }}>{d(p.cbm_total)}</Text>
            <Text style={{ width: 40, textAlign: "right" }}>{d(p.net_weight)}</Text>
            <Text style={{ width: 40, textAlign: "right" }}>{d(p.gross_weight)}</Text>
          </View>
        ))}
        <View style={s.totals}>
          <Text style={{ width: 230 }}>TOTALS</Text>
          <Text style={{ width: 40, textAlign: "right" }}>{result.total_packages}</Text>
          <Text style={{ width: 90 }} />
          <Text style={{ width: 45, textAlign: "right" }}>{result.total_cbm}</Text>
          <Text style={{ width: 40, textAlign: "right" }}>{result.net_weight}</Text>
          <Text style={{ width: 40, textAlign: "right" }}>{result.gross_weight}</Text>
        </View>

        {!!result.warnings.length && (
          <View>
            <Text style={s.sectionH}>Warnings</Text>
            {result.warnings.map((w, i) => <Text key={i} style={s.warn}>• {w}</Text>)}
          </View>
        )}
        <Text style={s.sectionH}>Packaging data versions used (snapshot)</Text>
        {result.packaging_versions_used.map((v, i) => (
          <Text key={i}>{d(v.reference)} — v{d(v.version_no)} — {v.item_id}</Text>
        ))}
      </Page>
    </Document>
  );
}

export async function renderPackingPdf(result: PackingResult, meta: PackingMeta): Promise<Buffer> {
  return renderToBuffer(<PackingDoc result={result} meta={meta} />);
}
