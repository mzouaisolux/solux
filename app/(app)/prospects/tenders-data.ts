// =====================================================================
// Shared server-side data assembly for the tender surfaces (m112):
// /prospects (discovery inbox) and /prospects/pipeline (work board).
// One loader, one shape — both screens read the SAME source of truth.
// =====================================================================

import { createClient } from "@/lib/supabase/server";
import { listAssignableOwners } from "@/lib/owner";
import { resolveUserLabelStrings } from "@/lib/user-display";
import { normalizeCompanyKey, fillEmptyContactsFromParticipant } from "@/lib/prospect-intel";
import type { ProspectRow } from "@/components/prospects/ProspectsPanel";
import type {
  TenderMRow,
  TenderActionRow,
  ParticipantRow,
  CompanyOption,
  OwnerOption,
} from "@/components/prospects/tender-shared";

export type ProspectTenderHistoryRow = {
  id: string;
  tender_id: string;
  title: string | null;
  country: string | null;
  buyer: string | null;
  date: string | null;
  amount: number | null;
  is_winner: boolean;
};

export type ProspectActivityRow = {
  id: string;
  prospect_id: string;
  kind: string;
  body: string | null;
  is_reply: boolean;
  happened_at: string;
};

export type TendersBundle = {
  prospects: ProspectRow[];
  prospectOptions: CompanyOption[];
  clients: CompanyOption[];
  tenders: TenderMRow[];
  owners: OwnerOption[];
  ownerLabels: Record<string, string>;
  /** V2 — lifetime tender history per prospect company (m116). */
  historyByProspect: Record<string, ProspectTenderHistoryRow[]>;
  /** V2 — commercial activity log per prospect company (m116). */
  activitiesByProspect: Record<string, ProspectActivityRow[]>;
};

export async function loadTendersBundle(): Promise<TendersBundle> {
  const supabase = createClient();
  const [prospectsRes, tendersRes, participantsRes, clientsRes, ownerOptions, activitiesRes] =
    await Promise.all([
      supabase.from("prospects").select("*").order("created_at", { ascending: false }),
      supabase.from("tenders").select("*").order("created_at", { ascending: false }),
      supabase.from("tender_participants").select("*").order("created_at", { ascending: true }),
      supabase.from("clients").select("id, company_name").order("company_name", { ascending: true }),
      listAssignableOwners(),
      // Defensive pre-m116: table missing → error → empty log.
      supabase
        .from("prospect_activities")
        .select("id, prospect_id, kind, body, is_reply, happened_at")
        .order("happened_at", { ascending: false })
        .limit(2000),
    ]);

  // Merged duplicates (m116) stay in the DB for audit but disappear
  // from every surface.
  let prospects = ((prospectsRes.data ?? []) as ProspectRow[]).filter(
    (p) => !(p as any).merged_into_id
  );
  const participants = (participantsRes.data ?? []) as ParticipantRow[];

  // DISPLAY-LEVEL contact merge (owner bug report 2026-06-13): a company
  // profile must NEVER show empty contact fields while its tender
  // participant rows carry them. Fill-empty at read time — whatever the
  // sync history of the row. Saving the profile then persists them.
  const contactByProspect = new Map<
    string,
    { email: string | null; phone: string | null; address: string | null; manager: string | null }
  >();
  const contactByNameKey = new Map<
    string,
    { email: string | null; phone: string | null; address: string | null; manager: string | null }
  >();
  for (const part of participants as any[]) {
    const pid = part.promoted_prospect_id as string | null;
    const key = pid ?? normalizeCompanyKey(part.company_name ?? "");
    if (!key) continue;
    const store = pid ? contactByProspect : contactByNameKey;
    const c =
      store.get(key) ?? { email: null, phone: null, address: null, manager: null };
    c.email ??= part.email ?? null;
    c.phone ??= part.phone ?? null;
    c.address ??= part.address ?? null;
    c.manager ??= part.manager_name ?? null;
    store.set(key, c);
  }
  prospects = prospects.map((pr) => {
    const byId = contactByProspect.get(pr.id);
    const byKey = contactByNameKey.get(
      ((pr as any).name_key as string | null) ?? normalizeCompanyKey(pr.company_name ?? "")
    );
    if (!byId && !byKey) return pr;
    let next: any = pr;
    if (byId) {
      next = fillEmptyContactsFromParticipant(next, {
        email: byId.email, phone: byId.phone, address: byId.address, manager_name: byId.manager,
      });
    }
    if (byKey) {
      next = fillEmptyContactsFromParticipant(next, {
        email: byKey.email, phone: byKey.phone, address: byKey.address, manager_name: byKey.manager,
      });
    }
    return next as ProspectRow;
  });
  const clients: CompanyOption[] = ((clientsRes.data ?? []) as any[]).map((c) => ({
    id: c.id,
    name: c.company_name,
  }));
  const prospectOptions: CompanyOption[] = prospects
    .filter(
      (p) =>
        !["converted", "discarded", "customer", "rejected", "blacklisted"].includes(p.status)
    )
    .map((p) => ({ id: p.id, name: p.company_name }));

  const rawTenders = (tendersRes.data ?? []) as any[];
  const tenderIds = rawTenders.map((t) => t.id);

  // Next actions (m107) — defensive pre-migration.
  const actionsByTender = new Map<string, TenderActionRow[]>();
  if (tenderIds.length > 0) {
    const { data: paRows, error: paErr } = await supabase
      .from("planned_actions")
      .select("id, tender_id, action_type, title, due_date, done_at")
      .in("tender_id", tenderIds)
      .order("due_date", { ascending: true });
    if (!paErr) {
      for (const a of (paRows ?? []) as any[]) {
        const arr = actionsByTender.get(a.tender_id);
        if (arr) arr.push(a);
        else actionsByTender.set(a.tender_id, [a]);
      }
    }
  }

  // Follow-up history (m110) — defensive pre-migration.
  const followupsByTender = new Map<string, any[]>();
  if (tenderIds.length > 0) {
    const { data: fuRows, error: fuErr } = await supabase
      .from("tender_followups")
      .select("id, tender_id, kind, comment, created_at")
      .in("tender_id", tenderIds)
      .order("created_at", { ascending: false });
    if (!fuErr) {
      for (const f of (fuRows ?? []) as any[]) {
        const arr = followupsByTender.get(f.tender_id);
        if (arr) arr.push(f);
        else followupsByTender.set(f.tender_id, [f]);
      }
    }
  }

  const ownerIds = [
    ...new Set(
      [
        ...rawTenders.map((t) => t.owner_id),
        ...prospects.map((p) => (p as any).owner_id),
      ].filter(Boolean) as string[]
    ),
  ];
  const ownerLabelMap = ownerIds.length
    ? await resolveUserLabelStrings(ownerIds)
    : new Map<string, string>();
  const ownerLabels: Record<string, string> = {};
  for (const [k, v] of ownerLabelMap.entries()) ownerLabels[k] = v;

  // ---- V2 intel maps (m116) ----
  // Lifetime tender history: every participant row linked to a prospect,
  // joined to its tender's identity. Source of truth for the history tab;
  // the denormalized counters on prospects only serve the LIST columns.
  const tenderById = new Map(rawTenders.map((t) => [t.id, t]));
  const historyByProspect: Record<string, ProspectTenderHistoryRow[]> = {};
  for (const part of participants as any[]) {
    const pid = part.promoted_prospect_id as string | null;
    if (!pid) continue;
    const t = tenderById.get(part.tender_id);
    const row: ProspectTenderHistoryRow = {
      id: part.id,
      tender_id: part.tender_id,
      title: t?.title ?? null,
      country: t?.country ?? part.country ?? null,
      buyer: t?.buyer ?? null,
      date:
        (t?.publication_date as string | null) ??
        (t?.created_at ? String(t.created_at).slice(0, 10) : null),
      amount: part.bid_value ?? t?.budget_usd ?? null,
      is_winner: !!part.is_winner,
    };
    (historyByProspect[pid] ??= []).push(row);
  }
  for (const rows of Object.values(historyByProspect)) {
    rows.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  }

  const activitiesByProspect: Record<string, ProspectActivityRow[]> = {};
  if (!activitiesRes.error) {
    for (const a of (activitiesRes.data ?? []) as ProspectActivityRow[]) {
      (activitiesByProspect[a.prospect_id] ??= []).push(a);
    }
  }

  const clientNameById = new Map(clients.map((c) => [c.id, c.name]));
  const prospectNameById = new Map(prospects.map((p) => [p.id, p.company_name]));
  const tenders: TenderMRow[] = rawTenders.map((t) => ({
    ...t,
    commercial_status: t.commercial_status ?? "new",
    specs: t.specs && typeof t.specs === "object" && !Array.isArray(t.specs) ? t.specs : {},
    documents: Array.isArray(t.documents) ? t.documents : [],
    attachedName: t.attached_client_id
      ? clientNameById.get(t.attached_client_id) ?? null
      : t.attached_prospect_id
        ? prospectNameById.get(t.attached_prospect_id) ?? null
        : null,
    participants: participants.filter((pp) => pp.tender_id === t.id),
    actions: actionsByTender.get(t.id) ?? [],
    followups: followupsByTender.get(t.id) ?? [],
  }));

  return {
    prospects,
    prospectOptions,
    clients,
    tenders,
    owners: ownerOptions.map((o) => ({ id: o.id, name: o.name })),
    ownerLabels,
    historyByProspect,
    activitiesByProspect,
  };
}
