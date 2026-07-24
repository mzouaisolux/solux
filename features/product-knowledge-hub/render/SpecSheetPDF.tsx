/**
 * Spec Sheet PDF — the auto-generated product datasheet (used when no designed
 * PDF is attached). Follows the Solux Spec-Sheet Style Guide: a two-column
 * technical page — left info column (wordmark, headline bullets, dimensions,
 * product code + warranty seal, certifications) and a right Signature-Mauve
 * grouped spec panel (Lighting · Battery · Energy · Electronic · Mechanical).
 *
 * Self-contained on purpose: only @react-pdf primitives + a local palette, so
 * `renderToBuffer` runs cleanly under the Node runtime. Poppins is registered
 * from the Google Fonts TTFs (best-effort; falls back to Helvetica on failure).
 */

import { Document, Page, Text, View, StyleSheet, Font } from "@react-pdf/renderer";

const POPPINS = "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/poppins";
try {
  Font.register({
    family: "Poppins",
    fonts: [
      { src: `${POPPINS}/Poppins-Light.ttf`, fontWeight: 300 },
      { src: `${POPPINS}/Poppins-Regular.ttf`, fontWeight: 400 },
      { src: `${POPPINS}/Poppins-Medium.ttf`, fontWeight: 500 },
      { src: `${POPPINS}/Poppins-SemiBold.ttf`, fontWeight: 600 },
    ],
  });
} catch {
  /* fall back to Helvetica if registration throws */
}

const C = {
  mauve: "#AEAABA",
  mauve700: "#6E6A78",
  mauve900: "#413F49",
  ink: "#232323",
  grey: "#5F5E63",
  line: "#CAC8D1",
  white: "#FFFFFF",
  panelRule: "#BCB9C6", // subtle divider on the mauve panel (solid — rgba misrenders)
  keyText: "#ECEBEF", // soft white for spec keys on mauve
};

const RIGHT_W = "54%";

const styles = StyleSheet.create({
  page: { fontSize: 9, color: C.ink },
  band: { position: "absolute", top: 60, bottom: 0, right: 0, width: RIGHT_W, backgroundColor: C.mauve },

  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingHorizontal: 30, paddingTop: 26, paddingBottom: 8 },
  brand: { fontSize: 20, fontWeight: 300, letterSpacing: 4, color: C.ink },
  titleWrap: { alignItems: "flex-end" },
  title: { fontSize: 20, fontWeight: 300, color: C.ink },
  modelLine: { fontSize: 9, color: C.mauve700, marginTop: 1 },

  body: { flexDirection: "row" },
  left: { width: "46%", paddingLeft: 30, paddingRight: 16, paddingTop: 12, paddingBottom: 30 },
  right: { width: RIGHT_W, paddingLeft: 18, paddingRight: 30, paddingTop: 12, paddingBottom: 30 },

  bullet: { flexDirection: "row", alignItems: "center", marginBottom: 6 },
  dot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: C.ink, marginRight: 8 },
  bKey: { fontSize: 13, fontWeight: 600, color: C.ink },
  bPipe: { fontSize: 13, color: C.mauve700, marginHorizontal: 5 },
  bVal: { fontSize: 13, color: C.ink },

  blockLabel: { fontSize: 11, fontWeight: 600, color: C.mauve900, marginTop: 18, marginBottom: 4 },
  dimRow: { flexDirection: "row", justifyContent: "space-between", borderTopWidth: 0.5, borderTopColor: C.line, paddingVertical: 4 },
  dimKey: { fontSize: 10, color: C.mauve700, fontWeight: 500 },
  dimVal: { fontSize: 10, color: C.ink },

  codeRow: { flexDirection: "row", alignItems: "center", marginTop: 20 },
  code: { fontSize: 28, fontWeight: 600, color: C.ink, marginRight: 16 },
  seal: { width: 58, height: 58, borderRadius: 29, borderWidth: 1.5, borderColor: C.mauve700, alignItems: "center", justifyContent: "center" },
  sealN: { fontSize: 18, fontWeight: 600, color: C.mauve900 },
  sealT: { fontSize: 7, fontWeight: 600, color: C.mauve900, letterSpacing: 0.5 },

  certLabel: { fontSize: 11, fontWeight: 600, color: C.mauve900, marginTop: 18, marginBottom: 3 },
  certVal: { fontSize: 9.5, color: C.grey },

  group: { marginBottom: 4 },
  groupTitle: { fontSize: 12, fontWeight: 600, color: C.white, marginTop: 12, marginBottom: 4 },
  specRow: { flexDirection: "row", justifyContent: "space-between", borderTopWidth: 0.5, borderTopColor: C.panelRule, paddingVertical: 4 },
  specKey: { fontSize: 9.5, color: C.keyText, flexShrink: 1, paddingRight: 8 },
  specVal: { fontSize: 9.5, fontWeight: 500, color: C.white, textAlign: "right" },

  footer: { position: "absolute", bottom: 18, left: 30, fontSize: 7, color: C.mauve700 },
});

export type SpecSheetSection = { title: string; rows: { label: string; value: string }[] };

export type SpecSheetPDFData = {
  productName: string;
  sku: string | null;
  categoryName: string | null;
  version: string;
  renderedOn: string;
  headline: { label: string; value: string }[];
  dimensions: { label: string; value: string }[];
  productCode: string;
  warrantyYears: string | null;
  certifications: string | null;
  groups: SpecSheetSection[];
};

export function SpecSheetPDF({ data, fontFamily = "Poppins" }: { data: SpecSheetPDFData; fontFamily?: string }) {
  const groups = data.groups.filter((g) => g.rows.length > 0);
  return (
    <Document title={`${data.productName} — Spec Sheet ${data.version}`}>
      <Page size="A4" style={[styles.page, { fontFamily }]}>
        <View style={styles.band} fixed />

        <View style={styles.header}>
          <Text style={styles.brand}>SOLUX</Text>
          <View style={styles.titleWrap}>
            <Text style={styles.title}>{data.productName}</Text>
            <Text style={styles.modelLine}>{data.sku ? `Model I ${data.sku}` : data.categoryName ?? ""}</Text>
          </View>
        </View>

        <View style={styles.body}>
          <View style={styles.left}>
            {data.headline.map((h) => (
              <View key={h.label} style={styles.bullet}>
                <View style={styles.dot} />
                <Text style={styles.bKey}>{h.label}</Text>
                <Text style={styles.bPipe}>I</Text>
                <Text style={styles.bVal}>{h.value}</Text>
              </View>
            ))}

            {data.dimensions.length > 0 ? (
              <>
                <Text style={styles.blockLabel}>Dimensions per {data.productName}</Text>
                {data.dimensions.map((d) => (
                  <View key={d.label} style={styles.dimRow}>
                    <Text style={styles.dimKey}>{d.label}</Text>
                    <Text style={styles.dimVal}>{d.value}</Text>
                  </View>
                ))}
              </>
            ) : null}

            <View style={styles.codeRow}>
              <Text style={styles.code}>{data.productCode}</Text>
              {data.warrantyYears ? (
                <View style={styles.seal}>
                  <Text style={styles.sealN}>{data.warrantyYears}</Text>
                  <Text style={styles.sealT}>YEARS</Text>
                </View>
              ) : null}
            </View>

            {data.certifications ? (
              <>
                <Text style={styles.certLabel}>Certifications</Text>
                <Text style={styles.certVal}>{data.certifications}</Text>
              </>
            ) : null}
          </View>

          <View style={styles.right}>
            {groups.length === 0 ? (
              <Text style={{ fontSize: 9, color: C.white }}>No values recorded.</Text>
            ) : (
              groups.map((g) => (
                <View key={g.title} style={styles.group} wrap={false}>
                  <Text style={styles.groupTitle}>{g.title}</Text>
                  {g.rows.map((r) => (
                    <View key={r.label} style={styles.specRow}>
                      <Text style={styles.specKey}>{r.label}</Text>
                      <Text style={styles.specVal}>{r.value}</Text>
                    </View>
                  ))}
                </View>
              ))
            )}
          </View>
        </View>

        <Text style={styles.footer} fixed>
          SOLUX · {data.productName} · spec {data.version}
        </Text>
      </Page>
    </Document>
  );
}

export default SpecSheetPDF;
