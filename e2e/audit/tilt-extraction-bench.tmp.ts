// =====================================================================
// BENCH IA — extraction du TILT ANGLE depuis des Energy Studies (m159).
// 4 fixtures PDF générées avec pdf-lib (texte réel), appels Claude RÉELS
// via lib/lighting/extract-energy-study.ts (clé .env.local) :
//   1. EN propre         « Tilt Angle: 15° »           → 15
//   2. FR                « Inclinaison … : 20° »        → 20
//   3. PIÈGE             Latitude 36.7° + Azimuth 180°, PAS de tilt → null
//      (le prompt interdit explicitement latitude/azimut — à prouver)
//   4. Variante          « PV Tilt: 30 deg »            → 30
// Vérifie aussi que lighting_power reste extrait (non-régression assist).
// unpdf absent → exerce volontairement le fallback raw-PDF (base64).
// =====================================================================
import { PDFDocument, StandardFonts } from "pdf-lib";
import { extractLightingFromEnergyStudy } from "../../lib/lighting/extract-energy-study.ts";

let ok = true;
const check = (label: string, cond: boolean, extra = "") => {
  console.log(`${cond ? "✓" : "✗"} ${label}${extra ? ` — ${extra}` : ""}`);
  if (!cond) ok = false;
};

async function makePdf(lines: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  let y = 780;
  for (const line of lines) {
    page.drawText(line, { x: 50, y, size: 12, font });
    y -= 22;
  }
  return doc.save();
}

const FIXTURES: Array<{
  name: string;
  lines: string[];
  expectTilt: number | null;
  expectPower?: number;
}> = [
  {
    name: "EN propre — Tilt Angle: 15°",
    lines: [
      "SOLUX ENERGY STUDY - Autonomous solar luminaire",
      "Project: Test bench - Zone A",
      "LUMINAIRE POWER: 40 W",
      "Solar panel: 120 Wp monocrystalline",
      "Tilt Angle: 15°",
      "Operating profile: 100% for 5h, 30% for 5h, 100% for 2h",
      "Total operating hours per night: 12",
      "Battery: LiFePO4 12.8V 60Ah - Autonomy 3 nights",
    ],
    expectTilt: 15,
    expectPower: 40,
  },
  {
    name: "FR — Inclinaison des panneaux : 20°",
    lines: [
      "ETUDE ENERGETIQUE SOLUX - Lampadaire solaire autonome",
      "Projet : Banc de test - Zone B",
      "PUISSANCE DU LUMINAIRE : 60 W",
      "Panneau solaire : 150 Wc",
      "Inclinaison des panneaux : 20°",
      "Fonctionnement : 100% pendant 6h, 20% pendant 4h, 100% pendant 2h",
      "Duree de fonctionnement : 12 heures par nuit",
    ],
    expectTilt: 20,
    expectPower: 60,
  },
  {
    name: "PIÈGE — latitude/azimut sans tilt",
    lines: [
      "SOLUX ENERGY STUDY - Site parameters",
      "Site latitude: 36.7° N",
      "Site longitude: 3.1° E",
      "Panel azimuth: 180° (due south)",
      "LUMINAIRE POWER: 30 W",
      "Operating hours: 11 per night at 100% output for 11h",
      "Note: panel tilt to be confirmed by the installation team.",
    ],
    expectTilt: null,
    expectPower: 30,
  },
  {
    name: "Variante — PV Tilt: 30 deg",
    lines: [
      "ENERGY & AUTONOMY STUDY",
      "Fixture wattage: 50 W",
      "PV Tilt: 30 deg",
      "Dimming schedule: 100% x 4h / 10% x 6h / 100% x 2h (12h total)",
    ],
    expectTilt: 30,
    expectPower: 50,
  },
];

for (const f of FIXTURES) {
  const pdf = await makePdf(f.lines);
  try {
    const ex = await extractLightingFromEnergyStudy({ pdf });
    check(
      `${f.name} → tilt_angle = ${f.expectTilt === null ? "null" : f.expectTilt}`,
      (ex.tilt_angle ?? null) === f.expectTilt,
      `got ${ex.tilt_angle ?? "null"} (conf ${ex.confidence?.tilt_angle ?? "—"})`
    );
    if (f.expectPower != null) {
      check(
        `${f.name} → lighting_power = ${f.expectPower} (non-régression)`,
        ex.lighting_power === f.expectPower,
        `got ${ex.lighting_power ?? "null"}`
      );
    }
  } catch (e: any) {
    check(`${f.name} → extraction ran`, false, e?.message ?? String(e));
  }
}

console.log(ok ? "\n✅ TILT EXTRACTION BENCH — PASS" : "\n❌ TILT EXTRACTION BENCH — FAIL");
process.exit(ok ? 0 : 1);
