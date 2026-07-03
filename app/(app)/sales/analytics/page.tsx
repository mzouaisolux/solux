// =====================================================================
// SALES INTELLIGENCE — /sales/analytics (§6, v3: interactive workspace).
//
// The server only fetches the raw register (+ filter option lists). ALL
// aggregation happens client-side in AnalyticsShell, so every global filter
// recomputes every tab instantly. Source of truth = the register; NULL
// sales_amount excluded (§3). The editable register (/sales) is untouched.
// =====================================================================
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { canAccessOrAdmin } from "@/lib/permissions";
import AccessDenied from "@/components/AccessDenied";
import type { IntelOrder } from "@/lib/sales/intelligence";
import AnalyticsShell, { type WorkspaceData } from "./AnalyticsShell";

export const dynamic = "force-dynamic";

export default async function SalesAnalyticsPage() {
  if (!(await canAccessOrAdmin(["sales_analytics.view"], { finance: true }))) return <AccessDenied capability="sales_analytics.view" />;

  const supabase = createClient();
  const COLS = "id, year, month, order_date, country, payment_terms, currency, sales_amount, received_amount, balance, saler:saler_id(name), client:sales_client_id(code, name)";
  const raw: any[] = [];
  for (let from = 0; from < 100000; from += 1000) {
    const { data, error } = await supabase.from("sales_orders").select(COLS).order("id").range(from, from + 999);
    if (error || !data || data.length === 0) break;
    raw.push(...data);
    if (data.length < 1000) break;
  }

  const rawOrders: IntelOrder[] = raw.map((o) => ({
    year: o.year == null ? null : Number(o.year),
    month: o.month == null ? null : Number(o.month),
    saler: o.saler?.name ?? null,
    sales_amount: o.sales_amount == null ? null : Number(o.sales_amount),
    date: o.order_date ?? null,
    country: (o.country ?? "").trim() || "—",
    clientCode: o.client?.code ?? "—",
    clientName: o.client?.name ?? "(inconnu)",
    received: o.received_amount == null ? null : Number(o.received_amount),
    balance: o.balance == null ? null : Number(o.balance),
    paymentTerms: (o.payment_terms ?? "").trim() || null,
    currency: (o.currency ?? "").trim() || null,
  }));

  const uniqSorted = (vals: (string | null)[]) => [...new Set(vals.filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b));
  const clientMap = new Map<string, string>();
  for (const o of rawOrders) if (!clientMap.has(o.clientCode)) clientMap.set(o.clientCode, o.clientName);

  const data: WorkspaceData = {
    rawOrders,
    years: [...new Set(rawOrders.map((o) => o.year).filter((y): y is number => y != null))].sort((a, b) => a - b),
    countries: uniqSorted(rawOrders.map((o) => o.country)),
    salers: uniqSorted(rawOrders.map((o) => (o.saler ? o.saler.toUpperCase() : null))),
    clientsIndex: [...clientMap.entries()].map(([code, name]) => ({ code, name })).sort((a, b) => (b.name || "").localeCompare(a.name || "")),
    paymentTerms: uniqSorted(rawOrders.map((o) => o.paymentTerms ?? null)),
    currencies: uniqSorted(rawOrders.map((o) => o.currency ?? null)),
    maxDate: rawOrders.reduce((m, o) => (o.date && o.date > m ? o.date : m), "") || new Date().toISOString().slice(0, 10),
  };

  return (
    <div className="mx-auto max-w-[1500px] px-6 py-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="eyebrow">Ventes &amp; Analytics · pilotage commercial</div>
          <h1 className="doc-title">Sales Intelligence</h1>
          <p className="mt-1 max-w-2xl text-sm text-neutral-500">Espace d&apos;exploration : filtre par année, pays, vendeur, client, statut… tout se recalcule instantanément. Source : le <strong>registre des commandes</strong>.</p>
        </div>
        <Link href="/sales" className="mt-1 shrink-0 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-neutral-700 hover:bg-neutral-50">← Registre</Link>
      </div>
      <AnalyticsShell data={data} />
    </div>
  );
}
