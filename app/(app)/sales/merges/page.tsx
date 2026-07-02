// =====================================================================
// SALES — merge validation queue (§4.3). Shows suspected duplicate clients
// (seeded from merge_suggestions.csv + any fuzzy hits) for a human to resolve.
// In-module only; never compares against the CRM.
// =====================================================================
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { canAccessOrAdmin } from "@/lib/permissions";
import AccessDenied from "@/components/AccessDenied";
import MergeQueue, { type Suggestion } from "../MergeQueue";

export const dynamic = "force-dynamic";

export default async function MergesPage() {
  const canSee = await canAccessOrAdmin(["sales_client.merge"]);
  if (!canSee) return <AccessDenied capability="sales_client.merge" />;

  const supabase = createClient();
  const { data: pending } = await supabase
    .from("sales_merge_suggestions")
    .select("id, score, client_a_id, client_b_id")
    .eq("status", "pending")
    .order("score", { ascending: false });

  const rows = (pending ?? []) as any[];
  const ids = [...new Set(rows.flatMap((r) => [r.client_a_id, r.client_b_id]).filter(Boolean))];

  const clientMap = new Map<string, { code: string; name: string }>();
  const agg = new Map<string, { orders: number; total: number }>();
  if (ids.length) {
    const [{ data: clients }, { data: orders }] = await Promise.all([
      supabase.from("sales_clients").select("id, code, name").in("id", ids),
      supabase.from("sales_orders").select("sales_client_id, sales_amount").in("sales_client_id", ids),
    ]);
    for (const c of (clients ?? []) as any[]) clientMap.set(c.id, { code: c.code, name: c.name });
    for (const o of (orders ?? []) as any[]) {
      const a = agg.get(o.sales_client_id) ?? { orders: 0, total: 0 };
      a.orders += 1;
      if (o.sales_amount != null) a.total += Number(o.sales_amount) || 0;
      agg.set(o.sales_client_id, a);
    }
  }

  const side = (id: string) => ({
    id,
    code: clientMap.get(id)?.code ?? "?",
    name: clientMap.get(id)?.name ?? "(inconnu)",
    orders: agg.get(id)?.orders ?? 0,
    total: agg.get(id)?.total ?? 0,
  });

  const suggestions: Suggestion[] = rows.map((r) => ({
    id: r.id,
    score: r.score == null ? null : Number(r.score),
    a: side(r.client_a_id),
    b: side(r.client_b_id),
  }));

  return (
    <div className="mx-auto max-w-3xl px-6 py-8 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="eyebrow">Ventes &amp; Analytics · qualité des données</div>
          <h1 className="doc-title">Doublons clients à valider</h1>
          <p className="mt-1 max-w-2xl text-sm text-neutral-500">
            Des clients qui se ressemblent — décide de les <strong>fusionner</strong> (les commandes et
            alias du doublon rejoignent le client gardé) ou de les <strong>garder séparés</strong>. Rien
            n&apos;est fusionné automatiquement.
          </p>
        </div>
        <Link href="/sales" className="mt-1 shrink-0 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-neutral-700 hover:bg-neutral-50">← Registre</Link>
      </div>
      <MergeQueue initial={suggestions} />
    </div>
  );
}
