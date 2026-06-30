/**
 * Geography rollup (CRM step 6) — country → region → continent.
 *
 * PLAN_CRM_SOLUX §9: Solux sells on several continents; the CRM must cut
 * everything by geo (pipeline per continent, win rate per region) WITHOUT
 * storing free text. The country is tagged once (clients / project
 * requests, canonical English names from lib/countries.ts) and this
 * reference map rolls it up automatically.
 *
 * Kept in code (not a DB table) on purpose for now: the rollup happens in
 * app views, a TS map is zero-migration and trivially editable, and it can
 * be promoted to a reference table later if SQL-side aggregation (or the
 * tenders app integration) needs it. Keyed by ISO alpha-2 code via
 * findCountry(), so legacy free-text values that don't resolve simply
 * fall into "Other".
 *
 * Pure data module — safe to import from client and server.
 */

import { findCountry } from "@/lib/countries";

export type Geo = { region: string; continent: string };

const REGION_DEFS: Array<{ continent: string; region: string; codes: string[] }> = [
  // ----- Africa -----
  { continent: "Africa", region: "North Africa", codes: ["DZ", "EG", "LY", "MA", "TN", "SD"] },
  {
    continent: "Africa",
    region: "West Africa",
    codes: ["BJ", "BF", "CV", "CI", "GM", "GH", "GN", "GW", "LR", "ML", "MR", "NE", "NG", "SN", "SL", "TG"],
  },
  {
    continent: "Africa",
    region: "Central Africa",
    codes: ["AO", "CM", "CF", "TD", "CG", "CD", "GQ", "GA", "ST"],
  },
  {
    continent: "Africa",
    region: "East Africa",
    codes: ["BI", "KM", "DJ", "ER", "ET", "KE", "MG", "MW", "MU", "MZ", "RW", "SC", "SO", "SS", "TZ", "UG", "ZM", "ZW"],
  },
  { continent: "Africa", region: "Southern Africa", codes: ["BW", "LS", "NA", "SZ", "ZA"] },

  // ----- Europe -----
  {
    continent: "Europe",
    region: "Western Europe",
    codes: ["AT", "BE", "FR", "DE", "IE", "LI", "LU", "MC", "NL", "CH", "GB"],
  },
  { continent: "Europe", region: "Northern Europe", codes: ["DK", "EE", "FI", "IS", "LV", "LT", "NO", "SE"] },
  {
    continent: "Europe",
    region: "Southern Europe",
    codes: ["AD", "AL", "BA", "HR", "CY", "GR", "IT", "MT", "ME", "MK", "PT", "SM", "RS", "SI", "ES", "VA"],
  },
  {
    continent: "Europe",
    region: "Eastern Europe",
    codes: ["BY", "BG", "CZ", "HU", "MD", "PL", "RO", "RU", "SK", "UA"],
  },

  // ----- Asia -----
  {
    continent: "Asia",
    region: "Middle East",
    codes: ["BH", "IQ", "IR", "IL", "JO", "KW", "LB", "OM", "PS", "QA", "SA", "SY", "TR", "AE", "YE"],
  },
  {
    continent: "Asia",
    region: "Central Asia & Caucasus",
    codes: ["AF", "AM", "AZ", "GE", "KZ", "KG", "TJ", "TM", "UZ"],
  },
  { continent: "Asia", region: "South Asia", codes: ["BD", "BT", "IN", "MV", "NP", "PK", "LK"] },
  {
    continent: "Asia",
    region: "Southeast Asia",
    codes: ["BN", "KH", "ID", "LA", "MY", "MM", "PH", "SG", "TH", "TL", "VN"],
  },
  { continent: "Asia", region: "East Asia", codes: ["CN", "JP", "KP", "KR", "MN", "TW"] },

  // ----- Americas -----
  { continent: "Americas", region: "North America", codes: ["CA", "MX", "US"] },
  {
    continent: "Americas",
    region: "Central America & Caribbean",
    codes: ["AG", "BS", "BB", "BZ", "CR", "CU", "DM", "DO", "SV", "GD", "GT", "HT", "HN", "JM", "NI", "PA", "KN", "LC", "VC", "TT"],
  },
  {
    continent: "Americas",
    region: "South America",
    codes: ["AR", "BO", "BR", "CL", "CO", "EC", "GY", "PY", "PE", "SR", "UY", "VE"],
  },

  // ----- Oceania -----
  {
    continent: "Oceania",
    region: "Oceania",
    codes: ["AU", "FJ", "KI", "MH", "FM", "NR", "NZ", "PW", "PG", "WS", "SB", "TO", "TV", "VU"],
  },
];

const BY_CODE = new Map<string, Geo>();
for (const def of REGION_DEFS) {
  for (const code of def.codes) {
    BY_CODE.set(code, { region: def.region, continent: def.continent });
  }
}

/** Roll a stored country name up to its region + continent. Null when the
 *  value is empty or doesn't resolve (legacy free text) — callers bucket
 *  those under "Other". */
export function geoOfCountry(countryName: string | null | undefined): Geo | null {
  const c = findCountry(countryName);
  if (!c) return null;
  return BY_CODE.get(c.code) ?? null;
}
