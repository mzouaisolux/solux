"use server";

// =====================================================================
// Tender duplicate consolidation — RETRO DRY-RUN (owner decision 4,
// 2026-06-13): future imports validated first, THEN a dry-run report on
// existing data BEFORE any write. This action READS ONLY and returns the
// proposed clusters; it never modifies the database.
// =====================================================================

import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/permissions";
import {
  clusterTenders,
  type IdentifiedTender,
  type TenderCluster,
} from "@/lib/tender-identity";

export type TenderMergeReport = {
  totalTenders: number;
  clusters: number;
  duplicates: number; // records that would fold into a principal
  projectedAfter: number; // totalTenders − duplicates
  flagged: number; // gray-zone (candidate) merges in the proposal
  groups: Array<{
    principal: { id: string; title: string | null; buyer: string | null; country: string | null; date: string | null; participantCount: number };
    duplicates: Array<{
      id: string; title: string | null; buyer: string | null; date: string | null;
      participantCount: number; via: string; score: number; confidence: string; reason: string;
    }>;
  }>;
  error: string | null;
};

export async function analyzeTenderDuplicates(): Promise<TenderMergeReport> {
  await requireCapability("admin.diagnostics");
  const supabase = createClient();

  let res: any = await supabase
    .from("tenders")
    .select("id, title, buyer, country, publication_date, market_reference, budget_usd, imported_at")
    .eq("type", "result")
    .limit(10000);
  if (res.error && /market_reference/.test(res.error.message ?? "")) {
    res = await supabase
      .from("tenders")
      .select("id, title, buyer, country, publication_date, budget_usd, imported_at")
      .eq("type", "result")
      .limit(10000);
  }
  if (res.error) {
    return { totalTenders: 0, clusters: 0, duplicates: 0, projectedAfter: 0, flagged: 0, groups: [], error: res.error.message };
  }
  const rows = (res.data ?? []) as any[];

  // participant counts (one read, tallied in memory)
  const countById = new Map<string, number>();
  {
    const ids = rows.map((r) => r.id);
    if (ids.length) {
      const { data: parts } = await supabase
        .from("tender_participants")
        .select("tender_id")
        .in("tender_id", ids.slice(0, 10000));
      for (const p of (parts ?? []) as any[]) {
        countById.set(p.tender_id, (countById.get(p.tender_id) ?? 0) + 1);
      }
    }
  }

  const tenders: IdentifiedTender[] = rows.map((r) => ({
    id: r.id,
    title: r.title ?? null,
    buyer: r.buyer ?? null,
    country: r.country ?? null,
    date: (r.publication_date as string | null)?.slice(0, 10) ?? null,
    marketRef: (r.market_reference as string | null) ?? null,
    amount: r.budget_usd != null ? Number(r.budget_usd) : null,
    participantCount: countById.get(r.id) ?? 0,
    importedAt: r.imported_at ?? null,
  }));

  const clusters: TenderCluster[] = clusterTenders(tenders);
  const duplicates = clusters.reduce((s, c) => s + c.duplicates.length, 0);
  const flagged = clusters.reduce(
    (s, c) => s + c.duplicates.filter((d) => d.confidence === "candidate").length,
    0
  );

  return {
    totalTenders: tenders.length,
    clusters: clusters.length,
    duplicates,
    projectedAfter: tenders.length - duplicates,
    flagged,
    groups: clusters
      .sort((a, b) => b.duplicates.length - a.duplicates.length)
      .map((c) => ({
        principal: {
          id: c.principal.id, title: c.principal.title, buyer: c.principal.buyer,
          country: c.principal.country, date: c.principal.date, participantCount: c.principal.participantCount,
        },
        duplicates: c.duplicates.map((d) => ({
          id: d.tender.id, title: d.tender.title, buyer: d.tender.buyer, date: d.tender.date,
          participantCount: d.tender.participantCount, via: d.via, score: d.score,
          confidence: d.confidence, reason: d.reason,
        })),
      })),
    error: null,
  };
}
