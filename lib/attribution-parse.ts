// =====================================================================
// Attribution JSON parsing — PURE functions, extracted from the import
// server action so the contact mapping is unit-testable against REAL
// J360 export entries (owner rule 2026-06-13: "tu vérifies avant de me
// dire" — the parsing that runs in prod is the parsing under test).
//
// Tested in tests/attribution-parse.test.ts with verbatim entries from
// projets_j360 exports.
// =====================================================================

/** First non-empty value among keys — "—" is the intelligence tool's
 *  "no value" placeholder and counts as empty. */
export const pick = (o: any, ...keys: string[]) => {
  for (const k of keys) {
    const v = o?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== "" && String(v).trim() !== "—")
      return v;
  }
  return null;
};

/** Parse "1 234 567 FCFA" / "12,5M" / 1234567 → number | null (best effort). */
export function parseAmount(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[\s ]/g, "").replace(/,/g, ".");
  const m = s.match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

/** One company entry from the file — the J360 export carries CONTACT
 *  intel (email / phone / address / manager / history) that m117 now
 *  stores on tender_participants instead of throwing it away. */
export type AttributionContact = {
  name: string;
  amount: number | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  manager: string | null;
  history: unknown;
};

/** Sub-objects where intelligence tools commonly NEST the contact info
 *  ({ societe, contact: { email, telephone } } and friends). */
export const CONTACT_NESTS = [
  "contact", "contacts", "coordonnees", "coordonnées", "details",
  "detail", "info", "infos", "contact_info",
] as const;

/** pick() across the object AND its known contact sub-objects — contact
 *  data must never be lost to one level of nesting (audit 2026-06-13). */
export function pickDeep(o: any, ...keys: string[]): string | null {
  const direct = pick(o, ...keys);
  if (direct != null) return String(direct);
  for (const nest of CONTACT_NESTS) {
    const sub = o?.[nest];
    if (sub && typeof sub === "object" && !Array.isArray(sub)) {
      const v = pick(sub, ...keys);
      if (v != null) return String(v);
    }
  }
  return null;
}

export const CONTACT_KEYS = {
  email: ["email", "mail", "e_mail", "courriel"],
  phone: ["telephone", "téléphone", "phone", "tel", "mobile", "portable", "gsm"],
  address: ["adresse", "address", "siege", "siège"],
  manager: ["dirigeant", "manager", "gerant", "gérant", "responsable", "directeur", "contact_person", "personne_contact"],
} as const;

export function participantEntry(v: unknown): AttributionContact | null {
  if (v == null) return null;
  if (typeof v === "string") {
    const name = v.trim();
    return name && name !== "—"
      ? { name, amount: null, email: null, phone: null, address: null, manager: null, history: null }
      : null;
  }
  if (typeof v === "object") {
    const o = v as any;
    const name = String(
      o.nom ?? o.name ?? o.company ?? o.societe ?? o.société ?? o.entreprise ?? ""
    ).trim();
    if (!name || name === "—") return null;
    return {
      name,
      amount: parseAmount(o.montant ?? o.amount ?? o.bid ?? null),
      email: pickDeep(o, ...CONTACT_KEYS.email),
      phone: pickDeep(o, ...CONTACT_KEYS.phone),
      address: pickDeep(o, ...CONTACT_KEYS.address),
      manager: pickDeep(o, ...CONTACT_KEYS.manager),
      history: o.historique ?? o.history ?? o.participations_historique ?? o.historique_j360 ?? null,
    };
  }
  return null;
}

/** Raw keys of a participant object (top level + contact nests) — feeds
 *  the contact-mapping audit shown in the import preview. */
export function rawKeysOf(v: unknown): string[] {
  if (!v || typeof v !== "object" || Array.isArray(v)) return [];
  const o = v as any;
  const keys = new Set<string>(Object.keys(o));
  for (const nest of CONTACT_NESTS) {
    const sub = o?.[nest];
    if (sub && typeof sub === "object" && !Array.isArray(sub)) {
      for (const k of Object.keys(sub)) keys.add(`${nest}.${k}`);
    }
  }
  return [...keys];
}

/**
 * J360 attribution exports are WINNER-CENTRIC: when `gagnant` is a plain
 * string, the attributaire's contact intel sits at the ITEM level —
 * email / telephone / dirigeant / adresse right NEXT TO `gagnant`, not
 * inside it. The participants keep their own contacts inside
 * participants_data and must NOT inherit the item-level ones.
 *
 * Bug AFRIK LONNYA SARL (2026-06-13): the winner card said "No email /
 * No phone" while the JSON carried contact@afriklonnya.com at the item
 * level. Fill-empty: an explicit winner OBJECT's own contacts always
 * win over the item-level fallback.
 */
export function applyWinnerItemContacts(
  winner: AttributionContact | null,
  item: unknown
): AttributionContact | null {
  if (!winner) return winner;
  const it = item as any;
  winner.email ??= pickDeep(item, ...CONTACT_KEYS.email);
  winner.phone ??= pickDeep(item, ...CONTACT_KEYS.phone);
  winner.address ??= pickDeep(item, ...CONTACT_KEYS.address);
  winner.manager ??= pickDeep(item, ...CONTACT_KEYS.manager);
  // Item-level tender history (historique_j360) is the WINNER's too.
  winner.history ??=
    it?.historique ?? it?.history ?? it?.participations_historique ?? it?.historique_j360 ?? null;
  return winner;
}

/* ------------------------------------------------------------------ */
/*  v2 export format (J360 "Bid Results" — Cameroun 2026-06):          */
/*  { meta, projets[], entreprises[] } — relational + multi-winner.    */
/*    projets[].gagnants[] = winners BY LOT { lot, entreprise,         */
/*      montant_local, montant_usd, quantite_lampadaires, telephone,   */
/*      delai }                                                        */
/*    entreprises[] = company directory { nom, contact{dirigeant,      */
/*      telephone, email, site, adresse, linkedin}, marches[] }        */
/* ------------------------------------------------------------------ */

/** Company directory of a v2 export root — exact-name lookup. */
export function companyDirectory(root: any): Map<string, any> {
  const map = new Map<string, any>();
  const list = Array.isArray(root?.entreprises) ? root.entreprises : [];
  for (const e of list) {
    const name = String(e?.nom ?? e?.name ?? "").trim();
    if (name && !map.has(name)) map.set(name, e);
  }
  return map;
}

/**
 * Winners of a v2 item: one AttributionContact per COMPANY — lots are
 * aggregated (amounts summed — a company can win several lots of the
 * same project), contacts enriched fill-empty from the entreprises[]
 * directory (its `contact` sub-object is a CONTACT_NEST, pickDeep reads
 * it natively; `marches` is the company's tender history).
 * Returns [] on old-format items (no `gagnants` array).
 */
export function winnersFromLots(
  item: any,
  directory: Map<string, any>
): AttributionContact[] {
  const lots = Array.isArray(item?.gagnants) ? item.gagnants : [];
  const byName = new Map<string, AttributionContact>();
  for (const lot of lots) {
    const name = String(lot?.entreprise ?? lot?.nom ?? lot?.name ?? "").trim();
    if (!name || name === "—") continue;
    const amount = parseAmount(lot?.montant_local ?? lot?.montant ?? lot?.amount);
    let cur = byName.get(name);
    if (!cur) {
      const dir = directory.get(name);
      cur = {
        name,
        amount: null,
        // Lot phone first (attribution-fresh), directory as fallback.
        email: dir ? pickDeep(dir, ...CONTACT_KEYS.email) : null,
        phone:
          pickDeep(lot, ...CONTACT_KEYS.phone) ??
          (dir ? pickDeep(dir, ...CONTACT_KEYS.phone) : null),
        address: dir ? pickDeep(dir, ...CONTACT_KEYS.address) : null,
        manager: dir ? pickDeep(dir, ...CONTACT_KEYS.manager) : null,
        history: dir?.marches ?? null,
      };
      byName.set(name, cur);
    }
    if (amount != null) cur.amount = (cur.amount ?? 0) + amount;
    cur.phone ??= pickDeep(lot, ...CONTACT_KEYS.phone);
  }
  return [...byName.values()];
}

/**
 * Split values into .in() chunks whose URL-encoded size stays under
 * `budget`. Import keys embed full tender titles — 111 of them is
 * ~30 KB of URL, silently rejected by the API gateway (2026-06-13:
 * a re-import said "111 new", then died on 111 duplicate keys).
 */
export function chunkByUrlBudget(
  values: string[],
  budget = 6000,
  maxCount = 30
): string[][] {
  const chunks: string[][] = [];
  let cur: string[] = [];
  let len = 0;
  for (const v of values) {
    const enc = encodeURIComponent(v).length + 3; // quotes + separator
    if (cur.length > 0 && (len + enc > budget || cur.length >= maxCount)) {
      chunks.push(cur);
      cur = [];
      len = 0;
    }
    cur.push(v);
    len += enc;
  }
  if (cur.length > 0) chunks.push(cur);
  return chunks;
}
