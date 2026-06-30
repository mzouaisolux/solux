// =====================================================================
// Dashboard items engine — Phase 2 (locked spec PLAN_CRM_SOLUX §11.2).
//
// The dashboard is a ROUTING LAYER: Critical → Due Today → Preventive,
// every item actionable, max 5 per block. This lib is the SINGLE place
// that decides what lands in which bucket — the page only renders.
//
// PURE functions over plain rows (node-testable, no supabase import):
//   • buildSalesItems  — the SALES tab (planned actions, reminders,
//     affairs without next action, blocked quotes, quotes without
//     reply, parked affairs)
//   • buildOpsPreventive — the OPERATIONS preventive block (ETA close,
//     prod deadline close, deposit received but task list incomplete)
//   • opsBucketOf — re-buckets Action Center sections into the spec's
//     three buckets (urgent→critical, waiting_me/info_missing→due
//     today, waiting_client→preventive)
//
// Locked definitions (validated by the owner):
//   • Devis BLOQUÉ (critical): sent + still active + NO open planned
//     action on its affair OR every open action overdue. An open
//     quotation reminder counts as "someone is pushing it". A quote
//     whose affair is already flagged "no next action" is NOT listed
//     twice — planning the affair's action resolves both.
//   • Affaire sans next action (critical): live affair, zero open
//     planned actions.
//   • Affaire endormie (preventive): live affair WITH open actions but
//     none due inside the preventive window (deal is parked).
//   • Devis sans réponse (preventive): still 'sent' after the window,
//     not already listed as blocked.
// The preventive window is the m120 admin setting (default 7 days) —
// passed in, never hardcoded here.
// =====================================================================

import type { ActionSection } from "./action-center";

export type DashboardBucket = "critical" | "due_today" | "preventive";

/** Pre-close commercial stages — the golden rule applies to these. */
export const LIVE_AFFAIR_STATUSES = [
  "lead",
  "tender_review",
  "partner_selection",
  "opportunity",
  "quotation",
  "negotiation",
] as const;

/** A quotation that is OUT and still alive commercially. */
export const ACTIVE_SENT_STATUSES = ["sent", "negotiating"] as const;

export const ACTION_LABEL: Record<string, string> = {
  call: "Call",
  meeting: "Meeting",
  visit: "Site visit",
  follow_up: "Follow-up",
  send_quote: "Send quote",
  other: "Action",
};

/* ------------------------------- rows ------------------------------ */

export type PlannedActionRow = {
  id: string;
  affair_id: string | null;
  tender_id?: string | null;
  action_type: string | null;
  title: string | null;
  due_date: string;
  affairs?: {
    id: string;
    name: string | null;
    status: string | null;
    archived_at: string | null;
    owner_id: string | null;
    created_by: string | null;
    clients?: { company_name?: string | null } | null;
  } | null;
  tenders?: { id: string; title: string | null; owner_id: string | null } | null;
};

export type AffairRow = {
  id: string;
  name: string | null;
  status: string | null;
  owner_id: string | null;
  created_by: string | null;
  archived_at: string | null;
  clients?: { company_name?: string | null } | null;
};

export type QuoteDocRow = {
  id: string;
  number: string | null;
  status: string | null;
  total_price: number | null;
  currency: string | null;
  date: string | null;
  created_by: string | null;
  sales_owner_id?: string | null;
  affair_id: string | null;
  root_document_id: string | null;
  version: number | null;
  archived_at: string | null;
};

export type ReminderRow = {
  id: string;
  user_id: string;
  document_id: string;
  remind_at: string;
  status: string;
  note: string | null;
  documents?: { number?: string | null } | null;
};

export type SalesItem = {
  id: string;
  kind:
    | "action_overdue"
    | "action_today"
    | "reminder_overdue"
    | "reminder_today"
    | "no_next_action"
    | "blocked_quote"
    | "quote_no_reply"
    | "parked_affair";
  bucket: DashboardBucket;
  title: string;
  subtitle: string | null;
  href: string;
  ownerId: string | null;
  dueDate: string | null;
  /** payloads for inline resolution */
  actionId?: string;
  affairId?: string | null;
  reminderId?: string;
};

export const ownerOfAffair = (a: {
  owner_id?: string | null;
  created_by?: string | null;
}): string | null => a?.owner_id ?? a?.created_by ?? null;

export const ownerOfDoc = (d: {
  sales_owner_id?: string | null;
  created_by?: string | null;
}): string | null => d?.sales_owner_id ?? d?.created_by ?? null;

/** Latest version per quotation family (root_document_id), archived
 *  excluded. Pass EVERY doc of the families of interest — the latest
 *  decides whether the family is still an active sent quote. */
export function latestPerFamily(docs: QuoteDocRow[]): QuoteDocRow[] {
  const byFamily = new Map<string, QuoteDocRow>();
  for (const d of docs) {
    if (d.archived_at) continue;
    const root = d.root_document_id ?? d.id;
    const cur = byFamily.get(root);
    if (!cur || (d.version ?? 1) >= (cur.version ?? 1)) byFamily.set(root, d);
  }
  return [...byFamily.values()];
}

const addDays = (isoDate: string, days: number): string => {
  const t = new Date(`${isoDate}T00:00:00Z`).getTime() + days * 86400000;
  return new Date(t).toISOString().slice(0, 10);
};

const daysBetween = (from: string, to: string): number =>
  Math.round(
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86400000
  );

const bySoonest = (a: SalesItem, b: SalesItem) =>
  (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || a.title.localeCompare(b.title);

/* --------------------------- SALES builder -------------------------- */

export function buildSalesItems(input: {
  /** OPEN planned actions (done_at null), affair or tender scoped. */
  actions: PlannedActionRow[];
  /** Live affairs (status in LIVE_AFFAIR_STATUSES, not archived). */
  affairs: AffairRow[];
  /** Every doc of the candidate quote families (see latestPerFamily). */
  quoteFamilyDocs: QuoteDocRow[];
  /** OPEN quotation reminders. */
  reminders: ReminderRow[];
  today: string;
  preventiveDays: number;
  /** null = All Items; a user id = My Items (owner ?? creator rule). */
  scopeUserId: string | null;
}): { critical: SalesItem[]; dueToday: SalesItem[]; preventive: SalesItem[] } {
  const { today, preventiveDays, scopeUserId } = input;
  const horizon = addDays(today, preventiveDays);

  const inScope = (ownerId: string | null) =>
    scopeUserId == null || ownerId === scopeUserId;

  // Open actions on live, unarchived parents only.
  const actions = input.actions.filter((a) =>
    a.affair_id ? !!a.affairs && !a.affairs.archived_at : !!a.tenders
  );
  const ownerOfAction = (a: PlannedActionRow): string | null =>
    a.affair_id ? ownerOfAffair(a.affairs ?? {}) : a.tenders?.owner_id ?? null;
  const actionItem = (a: PlannedActionRow, kind: SalesItem["kind"]): SalesItem => {
    const label = ACTION_LABEL[a.action_type ?? ""] ?? "Action";
    const parentName = a.affair_id ? a.affairs?.name : a.tenders?.title;
    const company = a.affairs?.clients?.company_name ?? null;
    return {
      id: `act:${a.id}`,
      kind,
      bucket: kind === "action_overdue" ? "critical" : "due_today",
      title: a.title?.trim() ? a.title : label,
      subtitle: [parentName, company].filter(Boolean).join(" · ") || null,
      href: a.affair_id ? `/affairs/${a.affair_id}` : `/prospects/tenders/${a.tender_id}`,
      ownerId: ownerOfAction(a),
      dueDate: a.due_date,
      actionId: a.id,
      affairId: a.affair_id,
    };
  };

  const scopedActions = actions.filter((a) => inScope(ownerOfAction(a)));
  const overdueActions = scopedActions
    .filter((a) => a.due_date < today)
    .map((a) => actionItem(a, "action_overdue"));
  const todayActions = scopedActions
    .filter((a) => a.due_date === today)
    .map((a) => actionItem(a, "action_today"));

  // Reminders are personal ticklers — owner IS the reminder's user.
  const reminders = input.reminders.filter(
    (r) => r.status === "open" && inScope(r.user_id)
  );
  const reminderItem = (r: ReminderRow, kind: SalesItem["kind"]): SalesItem => ({
    id: `rem:${r.id}`,
    kind,
    bucket: kind === "reminder_overdue" ? "critical" : "due_today",
    title: `Follow up quote ${r.documents?.number ?? ""}`.trim(),
    subtitle: r.note,
    href: `/documents/${r.document_id}`,
    ownerId: r.user_id,
    dueDate: r.remind_at,
    reminderId: r.id,
  });
  const overdueReminders = reminders
    .filter((r) => r.remind_at < today)
    .map((r) => reminderItem(r, "reminder_overdue"));
  const todayReminders = reminders
    .filter((r) => r.remind_at === today)
    .map((r) => reminderItem(r, "reminder_today"));

  // Golden rule: every live deal carries a next action.
  const openByAffair = new Set(
    actions.filter((a) => a.affair_id).map((a) => a.affair_id as string)
  );
  const liveAffairs = input.affairs.filter(
    (a) =>
      !a.archived_at &&
      (LIVE_AFFAIR_STATUSES as readonly string[]).includes(a.status ?? "")
  );
  const sleepingAffairs = liveAffairs.filter((a) => !openByAffair.has(a.id));
  const sleepingSet = new Set(sleepingAffairs.map((a) => a.id));
  const noNextAction = sleepingAffairs
    .filter((a) => inScope(ownerOfAffair(a)))
    .map(
      (a): SalesItem => ({
        id: `aff:${a.id}`,
        kind: "no_next_action",
        bucket: "critical",
        title: a.name ?? "Affair",
        subtitle: [a.clients?.company_name, a.status].filter(Boolean).join(" · ") || null,
        href: `/affairs/${a.id}`,
        ownerId: ownerOfAffair(a),
        dueDate: null,
        affairId: a.id,
      })
    );

  // Parked deals: actions exist, none inside the preventive window.
  const earliestDueByAffair = new Map<string, string>();
  for (const a of actions) {
    if (!a.affair_id) continue;
    const cur = earliestDueByAffair.get(a.affair_id);
    if (!cur || a.due_date < cur) earliestDueByAffair.set(a.affair_id, a.due_date);
  }
  const parked = liveAffairs
    .filter((a) => {
      const earliest = earliestDueByAffair.get(a.id);
      return earliest != null && earliest > horizon;
    })
    .filter((a) => inScope(ownerOfAffair(a)))
    .map(
      (a): SalesItem => ({
        id: `park:${a.id}`,
        kind: "parked_affair",
        bucket: "preventive",
        title: a.name ?? "Affair",
        subtitle: `Next action ${earliestDueByAffair.get(a.id)} — beyond the ${preventiveDays}d window`,
        href: `/affairs/${a.id}`,
        ownerId: ownerOfAffair(a),
        dueDate: earliestDueByAffair.get(a.id) ?? null,
        affairId: a.id,
      })
    );

  // Quotes: latest version decides; reminder = someone is pushing.
  const latest = latestPerFamily(input.quoteFamilyDocs);
  const activeSent = latest.filter((d) =>
    (ACTIVE_SENT_STATUSES as readonly string[]).includes(d.status ?? "")
  );
  const remindedDocs = new Set(reminders.map((r) => r.document_id));
  const openActionsByAffair = new Map<string, PlannedActionRow[]>();
  for (const a of actions) {
    if (!a.affair_id) continue;
    (openActionsByAffair.get(a.affair_id) ?? openActionsByAffair.set(a.affair_id, []).get(a.affair_id)!).push(a);
  }

  const isBlocked = (d: QuoteDocRow): boolean => {
    if (remindedDocs.has(d.id)) return false; // tickler = being pushed
    if (d.affair_id && sleepingSet.has(d.affair_id)) return false; // affair item covers it
    const open = d.affair_id ? openActionsByAffair.get(d.affair_id) ?? [] : [];
    if (open.length === 0) return true; // nobody pushing
    return open.every((a) => a.due_date < today); // pushed only by overdue actions
  };

  const blocked = activeSent
    .filter((d) => inScope(ownerOfDoc(d)))
    .filter(isBlocked)
    .map(
      (d): SalesItem => ({
        id: `blk:${d.id}`,
        kind: "blocked_quote",
        bucket: "critical",
        title: `Quote ${d.number ?? ""} has nobody pushing it`.trim(),
        subtitle: d.date ? `Sent ${d.date} · ${daysBetween(d.date, today)}d ago` : null,
        href: `/documents/${d.id}`,
        ownerId: ownerOfDoc(d),
        dueDate: d.date,
        affairId: d.affair_id,
      })
    );
  const blockedSet = new Set(blocked.map((b) => b.id.slice(4)));

  const noReply = activeSent
    .filter((d) => inScope(ownerOfDoc(d)))
    .filter((d) => !blockedSet.has(d.id))
    .filter((d) => d.date != null && d.date <= addDays(today, -preventiveDays))
    .map(
      (d): SalesItem => ({
        id: `nr:${d.id}`,
        kind: "quote_no_reply",
        bucket: "preventive",
        title: `Quote ${d.number ?? ""} — no reply for ${daysBetween(d.date!, today)}d`,
        subtitle: d.total_price
          ? `${Number(d.total_price).toLocaleString()} ${d.currency ?? ""}`.trim()
          : null,
        href: `/documents/${d.id}`,
        ownerId: ownerOfDoc(d),
        dueDate: d.date,
        affairId: d.affair_id,
      })
    );

  return {
    critical: [
      ...overdueActions.sort(bySoonest),
      ...overdueReminders.sort(bySoonest),
      ...noNextAction.sort(bySoonest),
      ...blocked.sort(bySoonest),
    ],
    dueToday: [...todayActions, ...todayReminders].sort(bySoonest),
    preventive: [...noReply.sort(bySoonest), ...parked.sort(bySoonest)],
  };
}

/* ----------------------- OPERATIONS helpers ------------------------ */

/** Locked spec mapping: Action Center sections → the three buckets. */
export function opsBucketOf(section: ActionSection): DashboardBucket {
  if (section === "urgent") return "critical";
  if (section === "waiting_client") return "preventive";
  return "due_today"; // waiting_me + info_missing: process today
}

export type OpsOrderRow = {
  id: string;
  order_number?: string | null;
  status: string | null;
  eta?: string | null;
  current_production_deadline?: string | null;
  quotation_id?: string | null;
  client_name?: string | null;
};

export type OpsPreventiveItem = {
  id: string;
  kind: "eta_close" | "prod_deadline_close" | "tasklist_incomplete";
  title: string;
  subtitle: string | null;
  href: string;
  dueDate: string | null;
};

const ORDER_TERMINAL = ["shipped", "delivered", "cancelled"];

/** Preventive block of the OPERATIONS tab (locked spec): shipment ETA
 *  close · production deadline close · deposit received but task list
 *  incomplete. windowDays = the m120 admin setting. */
export function buildOpsPreventive(input: {
  orders: OpsOrderRow[];
  /** quotation_id → task list status (draft / needs_revision / …). */
  taskListStatusByQuotation: Map<string, string>;
  today: string;
  windowDays: number;
}): OpsPreventiveItem[] {
  const { today, windowDays } = input;
  const horizon = addDays(today, windowDays);
  const items: OpsPreventiveItem[] = [];
  for (const o of input.orders) {
    if (ORDER_TERMINAL.includes(o.status ?? "")) continue;
    const label = o.order_number ?? o.client_name ?? o.id.slice(0, 6);
    if (o.eta && o.eta >= today && o.eta <= horizon) {
      items.push({
        id: `eta:${o.id}`,
        kind: "eta_close",
        title: `Shipment ETA in ${daysBetween(today, o.eta)}d — ${label}`,
        subtitle: o.client_name ?? null,
        href: `/operations/${o.id}`,
        dueDate: o.eta,
      });
    }
    if (
      o.current_production_deadline &&
      o.current_production_deadline >= today &&
      o.current_production_deadline <= horizon &&
      !["production_completed", "shipment_booked"].includes(o.status ?? "")
    ) {
      items.push({
        id: `pdl:${o.id}`,
        kind: "prod_deadline_close",
        title: `Production deadline in ${daysBetween(today, o.current_production_deadline)}d — ${label}`,
        subtitle: o.client_name ?? null,
        href: `/operations/${o.id}`,
        dueDate: o.current_production_deadline,
      });
    }
    if (
      ["deposit_received", "production_scheduled"].includes(o.status ?? "") &&
      o.quotation_id
    ) {
      const tl = input.taskListStatusByQuotation.get(o.quotation_id);
      if (tl === "draft" || tl === "needs_revision") {
        items.push({
          id: `tli:${o.id}`,
          kind: "tasklist_incomplete",
          title: `Deposit received but task list still ${tl === "draft" ? "draft" : "in revision"} — ${label}`,
          subtitle: o.client_name ?? null,
          href: `/operations/${o.id}`,
          dueDate: null,
        });
      }
    }
  }
  return items.sort(
    (a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || a.title.localeCompare(b.title)
  );
}
