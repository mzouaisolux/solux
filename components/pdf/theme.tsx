"use client";

/**
 * SOLUX PDF design system — single source of truth for every generated
 * document (quotation, proforma, invoice, factory task list…).
 *
 * Everything here is derived from the designer's cm grid reference
 * (`SLX INVOICE.v3.pdf`): 1.2 cm margins, 0.5/0.7/1.0 cm gaps, SLX-gray
 * hair-lines (#DCDDE1), Armin Grotesk body + Akzidenz-Grotesk BQ Light
 * Extended titles. Importing these tokens (instead of re-declaring them
 * per component) guarantees that the whole document ecosystem shares one
 * visual identity — change a value here and every PDF follows.
 */

import { Image, Text, View, StyleSheet } from "@react-pdf/renderer";
import { PDF_FONT_FAMILIES, registerPdfFonts } from "@/lib/pdfFonts";
import type { Currency } from "@/lib/types";

// Side-effect: register the brand fonts on module load. Keyed by family,
// so it's a no-op if another PDF component already triggered it.
registerPdfFonts();

/** Brand font families (body = Armin Grotesk, title = Akzidenz Extended). */
export const F = PDF_FONT_FAMILIES;

/* ---------------------------------------------------------------------------
   Grid — converted from the designer's cm spec. 1 cm = 28.35 pt.
   --------------------------------------------------------------------------- */
export const CM = 28.35;
export const M_OUT = 1.2 * CM; // page margin (34 pt)
export const GAP_S = 0.5 * CM; // tight block gap (14 pt)
export const GAP_M = 0.7 * CM; // medium block gap
export const GAP_L = 1.0 * CM; // large block gap (section breaks)

/* ---------------------------------------------------------------------------
   Palette. The first four are the canonical SOLUX neutrals used on EVERY
   document. The `fill` is the subtle backplate (table heads, zebra rows).
   The warn/danger tints are restrained on-brand status colors used only on
   the INTERNAL factory document (OVERRIDE / MISSING) — deliberately muted so
   the factory sheet still reads as part of the same family, not a different
   design language.
   --------------------------------------------------------------------------- */
export const COLORS = {
  ink: "#000000",
  body: "#1a1a1a",
  muted: "#525252",
  hair: "#DCDDE1",
  fill: "#F4F5F7",
  warnText: "#7a4a05",
  warnBg: "#FAF3E6",
  warnBorder: "#E4C788",
  dangerText: "#8a1f1f",
  dangerBg: "#FAECEC",
  dangerBorder: "#E0A4A4",
} as const;

/* ---------------------------------------------------------------------------
   Shared text helpers.
   --------------------------------------------------------------------------- */

/** "6,000.00" — thousands-separated, always two decimals. */
export function formatAmount(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Currency mark as it appears on the reference ("US$" not "USD"). */
export function currencyMark(cur: Currency | undefined | null): string {
  switch (cur) {
    case "USD":
      return "US$";
    case "EUR":
      return "€";
    case "CNY":
      return "¥";
    default:
      return cur ?? "";
  }
}

/* ---------------------------------------------------------------------------
   Shared masthead — logo left + company contact right. Identical on every
   document so the header is instantly recognizable across the ecosystem.
   --------------------------------------------------------------------------- */
const h = StyleSheet.create({
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  // Sized to the SOLUX wordmark's true ~4.19:1 aspect ratio.
  logoBox: { width: 145, height: 35 },
  logo: { width: "100%", height: "100%", objectFit: "contain" },
  companyBlock: { textAlign: "left", maxWidth: "60%" },
  companyName: { fontSize: 8, fontWeight: 400, color: COLORS.ink },
  companyLine: { fontSize: 8, fontWeight: 200, color: COLORS.body },
});

export function BrandHeader() {
  return (
    <View style={h.header} wrap={false}>
      <View style={h.logoBox}>
        <Image src="/solux-logo.png" style={h.logo} />
      </View>
      <View style={h.companyBlock}>
        <Text style={h.companyName}>SOLUX TECHNOLOGY Co. LTD</Text>
        <Text style={h.companyLine}>
          3rd Floor D1, Hutang Science &amp; Technology Industrial Park
        </Text>
        <Text style={h.companyLine}>
          Wujin Changzhou, Jiangsu Province, PRC 213161
        </Text>
        <Text style={h.companyLine}>Tel/Fax: +86 (0)21 33 63 77 31</Text>
        <Text style={h.companyLine}>www.solux-light.com</Text>
        <Text style={h.companyLine}>contact@solux-light.com</Text>
      </View>
    </View>
  );
}

/* ---------------------------------------------------------------------------
   Shared title + section primitives. A centered uppercase title (Akzidenz)
   with the document reference in Armin Black beside it — the exact pattern
   used on the quotation/invoice — plus a hair-line section header.
   --------------------------------------------------------------------------- */
const t = StyleSheet.create({
  titleWrap: { marginTop: GAP_L, alignItems: "center" },
  titleRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "baseline",
  },
  docTitle: {
    fontFamily: F.title,
    fontWeight: 300,
    fontSize: 14,
    letterSpacing: 1.5,
    color: COLORS.ink,
    textTransform: "uppercase",
  },
  docNumber: {
    fontFamily: F.body,
    fontWeight: 900,
    fontSize: 14,
    letterSpacing: 0.4,
    marginLeft: 14,
    color: COLORS.ink,
  },
  subCaption: {
    marginTop: 3,
    fontSize: 7.5,
    fontWeight: 400,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: COLORS.muted,
  },
  rule: {
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.hair,
    marginTop: GAP_S,
    marginBottom: GAP_S,
  },
  sectionHeader: {
    fontFamily: F.title,
    fontWeight: 300,
    fontSize: 10,
    color: COLORS.ink,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    marginBottom: 6,
  },
});

/** Centered document title + reference. Optional uppercase sub-caption. */
export function DocTitle({
  title,
  reference,
  caption,
}: {
  title: string;
  reference?: string | null;
  caption?: string | null;
}) {
  const ref = (reference ?? "").trim();
  return (
    <View style={t.titleWrap} wrap={false}>
      <View style={t.titleRow}>
        <Text style={t.docTitle}>{title}</Text>
        {ref ? <Text style={t.docNumber}>{ref}</Text> : null}
      </View>
      {caption ? <Text style={t.subCaption}>{caption}</Text> : null}
    </View>
  );
}

/** Hair-line separator. */
export function Rule() {
  return <View style={t.rule} />;
}

/** Uppercase Akzidenz section header (peer of the footer headers). */
export function SectionHeader({ children }: { children: string }) {
  return <Text style={t.sectionHeader}>{children}</Text>;
}
