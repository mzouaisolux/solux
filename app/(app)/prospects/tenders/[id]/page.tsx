// =====================================================================
// TENDER WORKSPACE — /prospects/tenders/[id] (Discovery V2 redesign,
// owner ruling 2026-06-13): the tender is a FIRST-CLASS CRM OBJECT.
//
// "I am working a business opportunity", not "I am viewing imported
// JSON". Server side assembles EVERYTHING the workspace needs in one
// parallel wave: the tender, its companies (+ CRM status of each), the
// tasks, the follow-ups and the activity timeline.
// =====================================================================

import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveRole } from "@/lib/auth";
import { hasUiCapability } from "@/lib/permissions";
import AccessDenied from "@/components/AccessDenied";
import { listAssignableOwners } from "@/lib/owner";
import { resolveUserLabelStrings } from "@/lib/user-display";
import { normalizeCompanyKey, fillEmptyContactsFromParticipant } from "@/lib/prospect-intel";
import { TenderWorkspace } from "./TenderWorkspace";

export const dynamic = "force-dynamic";

export default async function TenderWorkspacePage({
  params,
}: {
  params: { id: string };
}) {
  const { effectiveRole } = await getEffectiveRole();
  const canAccess = await hasUiCapability("prospect.access");
  if (!canAccess) return <AccessDenied capability="prospect.access" />;
  const canAssign = ["admin", "super_admin", "sales_director"].includes(effectiveRole ?? "");

  const supabase = createClient();
  const [tenderRes, partsRes, actionsRes, followupsRes, ownerOptions] = await Promise.all([
    supabase.from("tenders").select("*").eq("id", params.id).maybeSingle(),
    supabase
      .from("tender_participants")
      .select("*")
      .eq("tender_id", params.id)
      .order("is_winner", { ascending: false }),
    supabase
      .from("planned_actions")
      .select("id, action_type, title, due_date, done_at, created_at")
      .eq("tender_id", params.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("tender_followups")
      .select("id, kind, comment, created_at")
      .eq("tender_id", params.id)
      .order("created_at", { ascending: false }),
    listAssignableOwners(),
  ]);

  const tender = tenderRes.data as any;
  if (!tender) notFound();
  const participants = ((partsRes.data ?? []) as any[]);
  const actions = ((actionsRes.error ? [] : actionsRes.data ?? []) as any[]);
  const followups = ((followupsRes.error ? [] : followupsRes.data ?? []) as any[]);

  // ---- CRM status of every company (linked prospect OR name match) ----
  const promotedIds = participants.map((p) => p.promoted_prospect_id).filter(Boolean) as string[];
  const nameKeys = participants.map((p) => normalizeCompanyKey(p.company_name)).filter(Boolean);
  // Full rows — the in-place company profile drawer needs every field.
  const [byIdRes, byKeyRes] = await Promise.all([
    promotedIds.length
      ? supabase.from("prospects").select("*").in("id", promotedIds)
      : Promise.resolve({ data: [] } as any),
    nameKeys.length
      ? supabase
          .from("prospects")
          .select("*")
          .in("name_key", nameKeys)
          .is("merged_into_id", null)
      : Promise.resolve({ data: [] } as any),
  ]);
  const prospectById = new Map<string, any>();
  for (const r of ((byIdRes.data ?? []) as any[])) prospectById.set(r.id, r);
  const prospectByKey = new Map<string, any>();
  for (const r of ((byKeyRes.data ?? []) as any[])) {
    if (!prospectByKey.has(r.name_key)) prospectByKey.set(r.name_key, r);
  }
  /** participantId → { prospectId, status } (linked first, then name match). */
  const crmByParticipant: Record<string, { prospectId: string; status: string } | null> = {};
  for (const p of participants) {
    const linked = p.promoted_prospect_id ? prospectById.get(p.promoted_prospect_id) : null;
    const matched = linked ?? prospectByKey.get(normalizeCompanyKey(p.company_name)) ?? null;
    crmByParticipant[p.id] = matched
      ? { prospectId: matched.id, status: matched.status }
      : null;
  }

  // ---- In-place company profile data (drawer on THIS page — the user
  // never gets thrown back to the companies list) ----
  const linkedIds = [
    ...new Set(
      Object.values(crmByParticipant)
        .filter(Boolean)
        .map((r) => (r as any).prospectId as string)
    ),
  ];
  const prospectsById: Record<string, any> = {};
  for (const r of [...prospectById.values(), ...prospectByKey.values()]) {
    prospectsById[r.id] = r;
  }
  // DISPLAY-LEVEL contact merge (owner bug report 2026-06-13): the
  // profile drawer must show the participant's contacts even when the
  // prospect row hasn't been synced yet. Fill-empty, this tender's
  // participants first (cross-tender rows refine below).
  const fillFromParticipant = (pid: string, part: any) => {
    const pr = prospectsById[pid];
    if (!pr) return;
    prospectsById[pid] = fillEmptyContactsFromParticipant(pr, part);
  };
  for (const part of participants) {
    const ref = crmByParticipant[part.id];
    if (ref) fillFromParticipant(ref.prospectId, part);
  }
  const [crossHistRes, activitiesRes] = await Promise.all([
    linkedIds.length
      ? supabase
          .from("tender_participants")
          .select(
            "id, tender_id, promoted_prospect_id, is_winner, bid_value, country, email, phone, address, manager_name, tenders:tender_id(title, country, buyer, publication_date, budget_usd, created_at)"
          )
          .in("promoted_prospect_id", linkedIds)
      : Promise.resolve({ data: [] } as any),
    linkedIds.length
      ? supabase
          .from("prospect_activities")
          .select("id, prospect_id, kind, body, is_reply, happened_at")
          .in("prospect_id", linkedIds)
          .order("happened_at", { ascending: false })
          .limit(300)
      : Promise.resolve({ data: [], error: null } as any),
  ]);
  const historyByProspect: Record<string, any[]> = {};
  for (const part of ((crossHistRes.data ?? []) as any[])) {
    const pid = part.promoted_prospect_id as string;
    const td = part.tenders as any;
    (historyByProspect[pid] ??= []).push({
      id: part.id,
      tender_id: part.tender_id,
      title: td?.title ?? null,
      country: td?.country ?? part.country ?? null,
      buyer: td?.buyer ?? null,
      date:
        (td?.publication_date as string | null) ??
        (td?.created_at ? String(td.created_at).slice(0, 10) : null),
      amount: part.bid_value ?? td?.budget_usd ?? null,
      is_winner: !!part.is_winner,
    });
  }
  for (const rows of Object.values(historyByProspect)) {
    rows.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  }
  // Cross-tender contact refinement: a company's intel can live on its
  // participations in OTHER projects.
  for (const part of ((crossHistRes.data ?? []) as any[])) {
    fillFromParticipant(part.promoted_prospect_id, part);
  }
  const activitiesByProspect: Record<string, any[]> = {};
  if (!activitiesRes.error) {
    for (const a of ((activitiesRes.data ?? []) as any[])) {
      (activitiesByProspect[a.prospect_id] ??= []).push(a);
    }
  }

  // ---- Owner labels (project + companies + prospect owners) ----
  const ownerIds = [
    ...new Set(
      [
        tender.owner_id,
        ...participants.map((p) => p.owner_id),
        ...[...prospectById.values()].map((r) => r.owner_id),
      ].filter(Boolean) as string[]
    ),
  ];
  const labelMap = ownerIds.length
    ? await resolveUserLabelStrings(ownerIds)
    : new Map<string, string>();
  const ownerLabels: Record<string, string> = {};
  for (const [k, v] of labelMap.entries()) ownerLabels[k] = v;

  // ---- Activity timeline (derived — no new event types) ----
  type TimelineEntry = { at: string; label: string };
  const timeline: TimelineEntry[] = [];
  if (tender.imported_at ?? tender.created_at) {
    timeline.push({
      at: tender.imported_at ?? tender.created_at,
      label: "Tender imported into Solux",
    });
  }
  for (const a of actions) {
    timeline.push({
      at: a.created_at,
      label: `Task created${a.title ? `: ${a.title}` : ""} (due ${a.due_date})`,
    });
    if (a.done_at) {
      timeline.push({ at: a.done_at, label: `Task completed${a.title ? `: ${a.title}` : ""}` });
    }
  }
  for (const f of followups) {
    timeline.push({
      at: f.created_at,
      label: `Follow-up — ${String(f.kind).replace(/_/g, " ")}${f.comment ? `: ${f.comment}` : ""}`,
    });
  }
  for (const p of participants) {
    const linked = p.promoted_prospect_id ? prospectById.get(p.promoted_prospect_id) : null;
    if (linked?.created_at) {
      timeline.push({ at: linked.created_at, label: `${p.company_name} converted to prospect` });
    }
  }
  timeline.sort((a, b) => String(b.at).localeCompare(String(a.at)));

  return (
    <TenderWorkspace
      tender={tender}
      participants={participants}
      crmByParticipant={crmByParticipant}
      actions={actions}
      timeline={timeline.slice(0, 30)}
      owners={ownerOptions.map((o) => ({ id: o.id, name: o.name }))}
      ownerLabels={ownerLabels}
      canAssign={canAssign}
      prospectsById={prospectsById}
      historyByProspect={historyByProspect}
      activitiesByProspect={activitiesByProspect}
    />
  );
}
