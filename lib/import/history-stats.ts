/**
 * Historical Invoice Import — PURE customer-history rollup.
 *
 * After import, the customer page shows a rebuilt commercial history. This
 * module turns the imported documents (+ their product-linked lines) into the
 * exact figures the spec asks for: first/last order, count, lifetime revenue,
 * average & largest order, products purchased, and a year-by-year timeline.
 *
 * Money is bucketed PER CURRENCY (history can be multi-currency), matching how
 * the existing client workspace already aggregates `revenueByCurrency`. We never
 * sum across currencies.
 */

export type HistoryDoc = {
  id: string;
  number: string | null;
  doc_date: string | null; // yyyy-mm-dd
  currency: string | null;
  total_amount: number | null;
};

export type HistoryLineRef = {
  product_id: string | null;
  matched_product_name: string | null;
  quantity: number | null;
};

export type OrderRef = { id: string; number: string | null; date: string | null };

export type CustomerHistory = {
  count: number;
  firstOrder: OrderRef | null;
  lastOrder: OrderRef | null;
  lifetimeRevenueByCurrency: Record<string, number>;
  averageOrderValueByCurrency: Record<string, number>;
  largestOrder:
    | { id: string; number: string | null; date: string | null; currency: string; amount: number }
    | null;
  productsPurchased: { name: string; orders: number; quantity: number }[];
  timeline: { year: string; docs: OrderRef[] }[];
};

function yearOf(date: string | null): string {
  if (!date) return "—";
  const m = /^(\d{4})/.exec(date.trim());
  return m ? m[1] : "—";
}

/** Compare yyyy-mm-dd strings; nulls sort last. */
function byDateAsc(a: HistoryDoc, b: HistoryDoc): number {
  if (!a.doc_date && !b.doc_date) return 0;
  if (!a.doc_date) return 1;
  if (!b.doc_date) return -1;
  return a.doc_date < b.doc_date ? -1 : a.doc_date > b.doc_date ? 1 : 0;
}

/**
 * @param docs  imported documents (status='imported'), any order
 * @param linesByDoc  map: imported_document_id → its product-linked lines
 */
export function buildCustomerHistory(
  docs: HistoryDoc[],
  linesByDoc: Map<string, HistoryLineRef[]>
): CustomerHistory {
  const sorted = [...docs].sort(byDateAsc);
  const withDates = sorted.filter((d) => d.doc_date);

  const lifetime: Record<string, number> = {};
  const countByCurrency: Record<string, number> = {};
  let largest: CustomerHistory["largestOrder"] = null;

  for (const d of docs) {
    const cur = (d.currency ?? "").trim() || "—";
    const amt = Number(d.total_amount ?? 0) || 0;
    lifetime[cur] = (lifetime[cur] ?? 0) + amt;
    countByCurrency[cur] = (countByCurrency[cur] ?? 0) + 1;
    if (!largest || amt > largest.amount) {
      largest = { id: d.id, number: d.number, date: d.doc_date, currency: cur, amount: amt };
    }
  }

  const averageOrderValueByCurrency: Record<string, number> = {};
  for (const cur of Object.keys(lifetime)) {
    const n = countByCurrency[cur] || 0;
    averageOrderValueByCurrency[cur] = n > 0 ? lifetime[cur] / n : 0;
  }

  // Products purchased — distinct by product_id (fallback to name), counting
  // how many orders included it + total quantity.
  const prodAgg = new Map<string, { name: string; orders: number; quantity: number }>();
  for (const [, lines] of linesByDoc) {
    const seenInDoc = new Set<string>();
    for (const l of lines) {
      const name = (l.matched_product_name ?? "").trim();
      const pkey = l.product_id ?? (name ? `name:${name.toLowerCase()}` : "");
      if (!pkey || !name) continue;
      const cur = prodAgg.get(pkey) ?? { name, orders: 0, quantity: 0 };
      cur.quantity += Number(l.quantity ?? 0) || 0;
      if (!seenInDoc.has(pkey)) {
        cur.orders += 1;
        seenInDoc.add(pkey);
      }
      prodAgg.set(pkey, cur);
    }
  }
  const productsPurchased = Array.from(prodAgg.values()).sort(
    (a, b) => b.orders - a.orders || b.quantity - a.quantity || a.name.localeCompare(b.name)
  );

  // Timeline grouped by year, newest year first, orders within a year newest-first.
  const byYear = new Map<string, OrderRef[]>();
  for (const d of sorted) {
    const y = yearOf(d.doc_date);
    const arr = byYear.get(y) ?? [];
    arr.push({ id: d.id, number: d.number, date: d.doc_date });
    byYear.set(y, arr);
  }
  const timeline = Array.from(byYear.entries())
    .map(([year, ds]) => ({
      year,
      docs: ds.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")),
    }))
    .sort((a, b) => b.year.localeCompare(a.year));

  const first = withDates[0] ?? null;
  const last = withDates[withDates.length - 1] ?? null;

  return {
    count: docs.length,
    firstOrder: first ? { id: first.id, number: first.number, date: first.doc_date } : null,
    lastOrder: last ? { id: last.id, number: last.number, date: last.doc_date } : null,
    lifetimeRevenueByCurrency: lifetime,
    averageOrderValueByCurrency,
    largestOrder: largest,
    productsPurchased,
    timeline,
  };
}
