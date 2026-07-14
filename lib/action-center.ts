/**
 * Action Center engine — Phase 1 architecture: SENSORS → REGISTRY → MATERIALIZE.
 *
 * The old code mixed two concerns in every detector: SENSING (reading a table,
 * computing aging) and POLICY (behavior, who sees it, urgency, wording). Phase 1
 * separates them so we stop editing code every time a rule changes:
 *
 *   1. SENSORS (code, stable) — thin readers of each domain surface. They emit
 *      neutral SIGNALS: { kind, entity, owner, ageDays, amount, ctx }. They only
 *      change when the DATA MODEL changes, not when a rule changes.
 *
 *   2. ACTION_TYPES REGISTRY (data-as-config) — ONE declarative catalog keyed by
 *      `kind`. ALL policy lives here: behavior (action/followup/info), roles
 *      (who sees the kind), section, priority, resolution (auto_clear vs manual
 *      ack/done), and aging (when it escalates to urgent). Tune a rule = edit one
 *      entry. (Later this graduates to a DB table + admin UI — same shape.)
 *
 *   3. materialize(signal) — a tiny pure function: signal × registry → ActionItem.
 *      No per-kind branching anywhere else.
 *
 * Visibility (which ROWS) stays in lib/visibility.ts; the registry controls
 * which KINDS a role sees. State (ack / done) lives in action_acks (m069).
 *
 * Server-only.
 */

import { createClient } from "@/lib/supabase/server";
import { getVisibilityScope, canSeeRecord, canSeeRow } from "@/lib/visibility";
import { resolveUserLabelStrings } from "@/lib/user-display";
import { eventTypeLabel, type EventEntityType } from "@/lib/events-shared";
import {
  DOC_ACTIVE_STATUSES,
  PRODUCTION_COMPLETED_STATUSES,
  computeExpectedBalance,
  type PaymentMode,
  type PaymentTerms,
  type Role,
} from "@/lib/types";

/* ===================== Types & presentation ===================== */

export type ActionSection = "urgent" | "waiting_me" | "waiting_client" | "info_missing";
export type ActionBehavior = "action" | "followup" | "info";
export type ActionRole = "sales" | "task_list_manager" | "operations" | "management";
/** How an item leaves the list. auto_clear = self-clears when done IN the app;
 *  manual = an off-app thing — surfaces as Done (classic) / Acknowledge (V2). */
export type ActionResolution = "auto_clear" | "manual";

export type ActionKind =
  | "tl_validate"
  | "tl_clarify"
  | "doc_validate"
  | "deposit"
  | "production_late"
  | "balance_due"
  | "shipment_blocked"
  | "missing_deadline"
  | "won_no_tasklist"
  | "bl_missing_destination"
  | "tender_stalled"
  | "info";

export const ACTION_SECTION_ORDER: ActionSection[] = [
  "urgent",
  "waiting_me",
  "waiting_client",
  "info_missing",
];

export const SECTION_META: Record<
  ActionSection,
  { label: string; help: string; accent: string; dot: string }
> = {
  urgent: { label: "Urgent", help: "Blocking or overdue — handle now.", accent: "border-rose-200 bg-rose-50/40", dot: "bg-rose-500" },
  waiting_me: { label: "Waiting for me", help: "Needs your input to move forward.", accent: "border-amber-200 bg-amber-50/40", dot: "bg-amber-500" },
  waiting_client: { label: "Waiting on client", help: "The customer owes the next step — track & nudge.", accent: "border-sky-200 bg-sky-50/40", dot: "bg-sky-500" },
  info_missing: { label: "Info to complete", help: "Operational data that's still missing.", accent: "border-violet-200 bg-violet-50/40", dot: "bg-violet-500" },
};

export const BEHAVIOR_META: Record<ActionBehavior, { label: string; help: string }> = {
  action: { label: "Action required", help: "Workflow steps waiting on you. Clear them and they're gone." },
  followup: { label: "Follow-up", help: "Stay on top of these. Acknowledge to show you're handling it — they stay until the situation resolves." },
  info: { label: "Recent activity", help: "For awareness — nothing to do." },
};

export const ROLE_CHIP: Record<ActionRole, { label: string; cls: string }> = {
  sales: { label: "Sales", cls: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  task_list_manager: { label: "Task mgr", cls: "bg-sky-50 text-sky-700 border-sky-200" },
  operations: { label: "Ops", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  management: { label: "Mgmt", cls: "bg-neutral-100 text-neutral-700 border-neutral-200" },
};

/**
 * Compact "key: value" piece shown inline on a card so operators can read the
 * project's operational state without opening the underlying entity. Tone
 * tints the value (rose for slip / overdue, amber for warning, emerald for
 * good, neutral default).
 */
export type ActionContextChip = {
  label: string;
  value: string;
  tone?: "neutral" | "warn" | "danger" | "good";
};

/** A single micro-operational note pinned to an action item (m075). */
export type ActionNote = {
  id: string;
  body: string;
  createdAt: string;
  createdBy: string | null;
  authorLabel: string;
};

export type ActionItem = {
  id: string;
  kind: ActionKind;
  behavior: ActionBehavior;
  resolution: ActionResolution;
  section: ActionSection;
  roles: ActionRole[];
  priority: number;
  title: string;
  subtitle: string;
  href: string;
  /**
   * The ISSUE MAGNITUDE (e.g. factory slip days, days overdue). Drives SLA
   * stages and the "50d / 27d / 7d" red number on the card. NOT the same
   * thing as how long the card has been open — see `openedDaysAgo`.
   */
  ageDays: number | null;
  /** ISO timestamp the condition started — drives "Added Xd ago". */
  since: string | null;
  /**
   * How long this card has been sitting on the dashboard, in days. Derived
   * from `since` at materialize time so the UI doesn't have to. Different
   * from `ageDays` — that's the underlying issue's magnitude (slip days,
   * overdue days). `openedDaysAgo` is the card's own age, drives
   * accountability + prioritization independent of the issue size.
   */
  openedDaysAgo: number | null;
  amount: { value: number; currency: string } | null;
  /**
   * Inline operational context — baseline / production due on production_late,
   * incoterm + destination on BL cards, etc. Lets a sales person inform a
   * client without first opening the order. Empty array when there's nothing
   * extra to surface.
   */
  contextChips: ActionContextChip[];
  /** SLA stage badge ("Overdue" / "Escalated"), set by aging. */
  tag: string | null;
  acknowledgedByName?: string | null;
  acknowledgedAt?: string | null;
  /** When the underlying condition last changed — lets applyAcks expire a
   *  stale "done" ack so a worsening situation resurfaces (see Signal). */
  refreshedAt?: string | null;
  /** The underlying entity this card is about. Drives the canonical
   *  per-entity conversation (entity_messages) used as the card's notes —
   *  all cards on the same order/project share one operational-memory thread. */
  entityType: "document" | "task_list" | "production_order" | "client" | "tender";
  entityId: string;
  /** Number of notes on this card's entity conversation. 0 = nothing yet. */
  noteCount: number;
  /** Recent notes for inline preview (most-recent first, capped). */
  notes: ActionNote[];
};

/* ===================== THE REGISTRY (all policy, one place) ===================== */

type ActionTypeDef = {
  behavior: ActionBehavior;
  resolution: ActionResolution;
  /** Which roles see this KIND. (Row-level access is separate — visibility.ts.) */
  roles: ActionRole[];
  /** Default section; `aging` can promote it to "urgent". */
  section: ActionSection;
  priority: number;
  /** Static imperative phrasing (subtitle carries the affair·client context). */
  title: string;
  /**
   * SLA / aging — ordered stages (ascending `afterDays`). As an item ages, every
   * crossed stage applies cumulatively: it can promote the `section`, raise
   * `priority`, set a `tag` ("Overdue" / "Escalated"), and — the escalation
   * mechanic — widen the audience via `addRoles`. Escalation here means the item
   * CLIMBS into another role's Action Center (and to the top of Urgent), not a
   * push notification — deliberately calm, no dedup state, self-clearing.
   */
  sla?: {
    stages: {
      afterDays: number;
      section?: ActionSection;
      priority?: number;
      tag?: string;
      addRoles?: ActionRole[];
    }[];
  };
};

/**
 * The single source of operational policy. To change who sees a deposit
 * follow-up, its urgency, its wording, the overdue threshold, or whether it's
 * an in-app action vs an off-app follow-up — edit the relevant entry here.
 * Adding a brand-new condition still needs a sensor (below); everything else
 * is config.
 */
const ACTION_TYPES: Record<ActionKind, ActionTypeDef> = {
  tl_validate: {
    behavior: "action", resolution: "auto_clear", roles: ["task_list_manager"],
    section: "waiting_me", priority: 62,
    title: "Review task list before production can start",
    sla: {
      stages: [
        { afterDays: 3, section: "urgent", priority: 92, tag: "Overdue" },
        // Still un-reviewed after a week → it also climbs into management's view.
        { afterDays: 7, priority: 96, tag: "Escalated", addRoles: ["management"] },
      ],
    },
  },
  tl_clarify: {
    behavior: "action", resolution: "auto_clear", roles: ["sales"],
    section: "waiting_me", priority: 58,
    title: "Clarify task list so production can proceed",
  },
  doc_validate: {
    // Price/quote validation is an admin/super-admin concern only.
    // "management" resolves to admin + super_admin (no other role's view
    // includes it), so TLM / Operations / Sales never see it.
    behavior: "action", resolution: "auto_clear", roles: ["management"],
    section: "waiting_me", priority: 72,
    title: "Review quotation validation request",
  },
  deposit: {
    behavior: "followup", resolution: "manual", roles: ["sales"],
    section: "waiting_client", priority: 50,
    title: "Follow up deposit with client",
    sla: {
      stages: [
        { afterDays: 7, section: "urgent", priority: 88, tag: "Overdue" },
        // Two weeks unpaid → escalate into management's Action Center.
        { afterDays: 14, priority: 95, tag: "Escalated", addRoles: ["management"] },
      ],
    },
  },
  production_late: {
    behavior: "followup", resolution: "manual", roles: ["operations", "sales"],
    section: "urgent", priority: 82,
    title: "Production delayed — follow up with factory & inform client",
    // ageDays = the slip in days; a big slip escalates to management.
    sla: {
      stages: [
        { afterDays: 14, priority: 90, tag: "Escalated", addRoles: ["management"] },
      ],
    },
  },
  // Alert-routing audit fix: these two existed only as table/cockpit alerts
  // (computeOperationsAlert) — never as actionable items, so Sales got the
  // bell notification but nothing in the action area. Both block execution.
  balance_due: {
    behavior: "followup", resolution: "manual", roles: ["sales", "operations"],
    section: "urgent", priority: 84,
    title: "Balance outstanding — collect before shipment",
    sla: {
      stages: [
        { afterDays: 14, priority: 94, tag: "Escalated", addRoles: ["management"] },
      ],
    },
  },
  shipment_blocked: {
    behavior: "followup", resolution: "manual", roles: ["operations", "sales"],
    section: "urgent", priority: 80,
    title: "Production complete — shipment not booked",
    sla: {
      stages: [
        { afterDays: 14, priority: 88, tag: "Escalated", addRoles: ["management"] },
      ],
    },
  },
  missing_deadline: {
    behavior: "action", resolution: "auto_clear", roles: ["operations"],
    section: "info_missing", priority: 44,
    title: "Set production deadline",
  },
  won_no_tasklist: {
    behavior: "action", resolution: "auto_clear", roles: ["sales"],
    section: "waiting_me", priority: 65,
    title: "Create the production task list for this won deal",
  },
  bl_missing_destination: {
    behavior: "action", resolution: "auto_clear", roles: ["sales"],
    section: "info_missing", priority: 40,
    title: "Confirm BL & shipping info before booking",
  },
  // m110 critical rule: an ACCEPTED tender must never sit without a next
  // action. Self-clears the moment one is planned; escalates to the
  // manager after 3 days of drift.
  tender_stalled: {
    behavior: "action", resolution: "auto_clear", roles: ["sales"],
    section: "urgent", priority: 78,
    title: "Accepted tender without next action — plan the next step",
    sla: {
      stages: [
        { afterDays: 3, priority: 86, tag: "Escalated", addRoles: ["management"] },
      ],
    },
  },
  info: {
    behavior: "info", resolution: "auto_clear",
    roles: ["sales", "operations", "task_list_manager"],
    section: "waiting_client", priority: 0, title: "",
  },
};

/* ===================== Signals + materialize ===================== */

type SignalEntity = "document" | "task_list" | "production_order" | "client" | "tender";

type Signal = {
  kind: ActionKind;
  entityType: SignalEntity;
  entityId: string;
  ownerId: string | null;
  ctx: string;
  ageDays?: number | null;
  /** ISO timestamp the condition started (drives "on the list since…").
   *  When ageDays is omitted, it's derived from this. */
  since?: string | null;
  amount?: { value: number; currency: string } | null;
  /** Inline operational context (baseline, production due, incoterm, balance…). */
  contextChips?: ActionContextChip[];
  /** info items carry a dynamic title + a distinct key/href. */
  titleOverride?: string;
  idOverride?: string;
  hrefOverride?: string;
  /** ISO timestamp the underlying condition last CHANGED (e.g. the latest
   *  delay event). A manual "Done" ack only suppresses the card while it is
   *  NEWER than this — when the condition evolves again after the Done, the
   *  card resurfaces (alert-routing audit fix: previously a Done hid the
   *  card forever, even as the delay kept growing). */
  refreshedAt?: string | null;
};

/**
 * Does the SELLER manage destination shipping for this deal? Only then does a
 * BL / shipping-completion action make sense.
 *   - EXW / FOB → buyer arranges destination; NO action (keep it calm).
 *   - CFR / CIF / DDP / DDU → seller ships to destination; action applies.
 *   - LCL (groupage) → shipment is managed regardless of incoterm.
 */
const SHIPPING_INCOTERMS = new Set(["CFR", "CIF", "DDP", "DDU"]);
function blRequired(incoterm: string | null, freightType: string | null): boolean {
  if ((freightType ?? "").toUpperCase() === "LCL") return true;
  return !!incoterm && SHIPPING_INCOTERMS.has(incoterm.toUpperCase());
}

// Option A: BL / shipping completion is only worth chasing once the deposit
// is in / production has launched — never on uncertain pre-deposit deals.
// (Excludes awaiting_deposit and the shipping stages, where BL is already done.)
const BL_STAGE_STATUSES = new Set([
  "deposit_received",
  "production_scheduled",
  "in_production",
  "production_delayed",
  "production_completed",
]);

/** Compact "MMM dd" — used on context chips where space is tight. */
function fmtShortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "2-digit",
  });
}

/**
 * "Has the operator actually filled the BL info?" — drives the BL action's
 * self-clear. We treat ANY of these as evidence that someone's handled it:
 *   - client.bl_profile.consignee.company_name (filled)
 *   - order.shipping_details.bl_number / forwarder / vessel (filled)
 *
 * Loose by design — we want false-negatives (card stays) over false-positives
 * (card disappears with empty BL info). The threshold is "something
 * operationally meaningful is set."
 */
function blIsFilled(
  blProfile: any | null,
  shippingDetails: any | null
): boolean {
  const consigneeCompany =
    blProfile && typeof blProfile === "object"
      ? String(blProfile.consignee?.company_name ?? "").trim()
      : "";
  if (consigneeCompany) return true;
  if (shippingDetails && typeof shippingDetails === "object") {
    // Decision G fix: read the keys the editor actually stores
    // (lib/shipping.ts ShippingDetails = forwarder / vessel / bl_number) —
    // NOT the old forwarder_name / vessel_name, which never matched, so the
    // "BL missing" card never self-cleared on forwarder/vessel entry.
    // Minimum to clear = forwarder (bl_number may arrive later, not required).
    for (const key of ["bl_number", "forwarder", "vessel"]) {
      const v = String((shippingDetails as any)[key] ?? "").trim();
      if (v) return true;
    }
  }
  return false;
}

function entityHref(t: SignalEntity, id: string): string {
  switch (t) {
    case "document": return `/documents/${id}`;
    case "task_list": return `/task-lists/${id}`;
    case "production_order": return `/production/orders/${id}`;
    case "client": return `/clients/${id}`;
    case "tender": return "/prospects";
  }
}

/** signal × registry → ActionItem. The ONLY place policy is applied. */
function materialize(s: Signal): ActionItem {
  const def = ACTION_TYPES[s.kind];
  let section = def.section;
  let priority = def.priority;
  let roles = def.roles;
  let tag: string | null = null;

  // Unified age: explicit ageDays (e.g. production slip) else derived from `since`.
  const ageDays = s.ageDays ?? ageDaysFrom(s.since);

  // Apply every crossed SLA stage (ordered ascending; later stages win on
  // section/priority/tag, escalation roles accumulate).
  const age = ageDays ?? 0;
  if (def.sla) {
    for (const stage of def.sla.stages) {
      if (age < stage.afterDays) continue;
      if (stage.section) section = stage.section;
      if (stage.priority != null) priority = stage.priority;
      if (stage.tag) tag = stage.tag;
      if (stage.addRoles?.length) roles = Array.from(new Set([...roles, ...stage.addRoles]));
    }
  }

  return {
    id: s.idOverride ?? `${s.kind}:${s.entityId}`,
    kind: s.kind,
    behavior: def.behavior,
    resolution: def.resolution,
    section,
    roles,
    priority,
    title: s.titleOverride ?? def.title,
    subtitle: s.ctx,
    href: s.hrefOverride ?? entityHref(s.entityType, s.entityId),
    ageDays,
    since: s.since ?? null,
    // Card open age — derived from `since`. Independent of ageDays (which is
    // the issue magnitude). For derived sensors `since` is the moment the
    // condition first became true (earliest delay event, deposit due date,
    // validation request, etc.) so this reads as "card has been open for X".
    openedDaysAgo: ageDaysFrom(s.since),
    amount: s.amount ?? null,
    contextChips: s.contextChips ?? [],
    tag,
    refreshedAt: s.refreshedAt ?? null,
    entityType: s.entityType,
    entityId: s.entityId,
    noteCount: 0,
    notes: [],
  };
}

/* ===================== Sensors (thin readers) ===================== */

type SupabaseClient = ReturnType<typeof createClient>;
const DAY = 86_400_000;
function ageDaysFrom(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / DAY));
}

/**
 * Read every operational surface and emit neutral signals (visibility-scoped).
 * Sensors decide WHAT exists; the registry decides what it MEANS. One Promise.all
 * keeps it to a single round-trip.
 */
async function gatherSignals(
  supabase: SupabaseClient,
  // PERF (2026-07-11): accept the scope as a PROMISE so the visibility fetch
  // (access_grants, ~1 round-trip) overlaps the main data wave below instead
  // of running serially before it. Scope is only needed for the client-side
  // canSeeRecord/canSeeRow filtering AFTER the queries return, so we await it
  // right before the first filter. Resolved value is identical — timing only.
  scopePromise:
    | Awaited<ReturnType<typeof getVisibilityScope>>
    | Promise<Awaited<ReturnType<typeof getVisibilityScope>>>
): Promise<Signal[]> {
  const signals: Signal[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [
    taskListsRes,
    validationRes,
    ordersRes,
    wonRes,
    tlIdsRes,
    deadlineChangesRes,
  ] = await Promise.all([
    supabase
      .from("production_task_lists")
      .select("id, number, status, submitted_at, quotation_id, clients(company_name), documents:quotation_id(created_by, affair_name, number)")
      .in("status", ["under_validation", "needs_revision"])
      .limit(500),
    supabase
      .from("documents")
      .select("id, number, affair_name, created_by, validation_status, validation_requested_at, total_price, currency, clients:client_id(company_name)")
      .eq("validation_status", "pending")
      .limit(300),
    supabase
      .from("production_orders")
      .select(
        // m075: also pull shipping_details (BL execution) + client.bl_profile
        // so the BL action can self-clear once the operator has actually
        // saved consignee / BL number / forwarder somewhere.
        // Alert-routing audit: + balance_received_amount / shipment_booked /
        // actual_completion_date (PO) and payment_mode / payment_terms (doc)
        // so the balance_due + shipment_blocked sensors can fire.
        "id, number, status, initial_production_deadline, current_production_deadline, created_at, deposit_received_amount, balance_received_amount, shipment_booked, actual_completion_date, shipping_details, quotation_id, documents:quotation_id(created_by, sales_owner_id, client_id, affair_name, number, total_price, currency, incoterm, freight_type, port_of_destination, payment_mode, payment_terms, root_document_id, version, clients:client_id(company_name, bl_profile))"
      )
      .limit(500),
    supabase
      .from("documents")
      .select("id, number, affair_name, created_by, sales_owner_id, status, date, total_price, currency, clients:client_id(company_name)")
      .eq("status", "won")
      .limit(500),
    supabase.from("production_task_lists").select("quotation_id").limit(5000),
    // m072 + m073 — load delay events so the production_late sensor only
    // counts FACTORY slip (delay_type = 'production' or NULL legacy). Each
    // event's contribution comes from `days_added` post-m073, falling back
    // to (new_date - previous_date) for un-backfilled rows.
    // Soft-fails to an empty list if the column isn't migrated yet.
    supabase
      .from("production_deadline_changes")
      .select(
        "production_order_id, previous_date, new_date, days_added, delay_type, reason, created_at"
      )
      .limit(5000),
  ]);

  // Scope resolved concurrently with the wave above; needed from here on for
  // the client-side visibility filters (canSeeRecord / canSeeRow).
  const scope = await scopePromise;

  // Build factoryDelayByOrder map from the delay-event rows.
  // Σ days_added where delay_type = 'production' (or NULL = legacy = production).
  // Also remember the EARLIEST factory-tagged event timestamp per order — that's
  // when the production_late card first deserved to be open, drives the
  // "Added Xd ago" footer on the card so it reads operationally honest.
  const factoryDelayByOrder = new Map<string, number>();
  const factoryEarliestByOrder = new Map<string, string>();
  // Latest delay event of ANY attribution per order — drives the "done ack
  // expires when the situation changes again" rule (refreshedAt).
  const latestChangeByOrder = new Map<string, string>();
  if (!deadlineChangesRes.error) {
    for (const r of (deadlineChangesRes.data ?? []) as any[]) {
      {
        const oid = String(r.production_order_id);
        const ts = String(r.created_at ?? "");
        const prevTs = latestChangeByOrder.get(oid);
        if (ts && (!prevTs || ts > prevTs)) latestChangeByOrder.set(oid, ts);
      }
      const t = (r.delay_type ?? "production") as string;
      if (t !== "production") continue;
      let delta: number;
      if (r.days_added != null) {
        delta = Number(r.days_added);
      } else {
        const a = r.previous_date
          ? Date.parse(r.previous_date + "T00:00:00Z")
          : NaN;
        const b = Date.parse(r.new_date + "T00:00:00Z");
        if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
        delta = Math.round((b - a) / 86_400_000);
      }
      if (!Number.isFinite(delta) || delta === 0) continue;
      const id = String(r.production_order_id);
      factoryDelayByOrder.set(id, (factoryDelayByOrder.get(id) ?? 0) + delta);
      const ts = String(r.created_at ?? "");
      if (ts) {
        const prev = factoryEarliestByOrder.get(id);
        if (!prev || ts < prev) factoryEarliestByOrder.set(id, ts);
      }
    }
  }

  const money = (v: any, c: any) =>
    v ? { value: Number(v), currency: (c ?? "USD") as string } : null;

  // SENSOR: task lists (validation / revision)
  for (const t of (taskListsRes.data ?? []) as any[]) {
    const owner = (t.documents?.created_by as string | null) ?? null;
    if (!canSeeRecord(scope, { ownerId: owner, kind: "task_list", status: t.status })) continue;
    const ctx = `${t.documents?.affair_name || t.number} · ${t.clients?.company_name ?? "—"}`;
    signals.push({
      kind: t.status === "under_validation" ? "tl_validate" : "tl_clarify",
      entityType: "task_list", entityId: t.id, ownerId: owner, ctx,
      since: t.submitted_at,
    });
  }

  // SENSOR: pending quotation validation requests (m068)
  if (!validationRes.error) {
    for (const d of (validationRes.data ?? []) as any[]) {
      const owner = (d.created_by as string | null) ?? null;
      if (!canSeeRow(scope, owner)) continue;
      signals.push({
        kind: "doc_validate", entityType: "document", entityId: d.id, ownerId: owner,
        ctx: `${d.affair_name || d.number} · ${d.clients?.company_name ?? "—"}`,
        since: d.validation_requested_at,
        amount: money(d.total_price, d.currency),
      });
    }
  }

  // Resolve the LATEST version of each order's affair (m059). A production
  // order stays linked to the version that spawned its task list; if Sales
  // later revises the quote, the operational data — incoterm, ports, amount,
  // owner — must be read from the LATEST version so the whole team works off
  // the current quote, never a superseded one. Soft-fails to the linked
  // version if m059 isn't applied.
  const orderRoots = Array.from(
    new Set(
      ((ordersRes.data ?? []) as any[])
        .map((o) => o.documents?.root_document_id ?? o.quotation_id)
        .filter(Boolean)
    )
  );
  const latestByRoot = new Map<string, any>();
  if (orderRoots.length > 0) {
    const idList = orderRoots.join(",");
    const { data: versions } = await supabase
      .from("documents")
      .select("id, root_document_id, version, created_by, sales_owner_id, client_id, affair_name, number, total_price, currency, incoterm, freight_type, port_of_destination, clients:client_id(company_name)")
      .or(`root_document_id.in.(${idList}),id.in.(${idList})`);
    for (const v of (versions ?? []) as any[]) {
      const root = (v.root_document_id ?? v.id) as string;
      const cur = latestByRoot.get(root);
      if (!cur || Number(v.version ?? 1) > Number(cur.version ?? 1)) latestByRoot.set(root, v);
    }
  }

  // SENSOR: production orders (deposit / deadline / lateness / BL).
  // Owner = sales_owner_id ?? created_by (the universal deal-owner anchor,
  // m066) on the LATEST affair version, so the deposit follow-up reaches the
  // actual SALES owner even when the quote was keyed in by someone else.
  for (const o of (ordersRes.data ?? []) as any[]) {
    const root = (o.documents?.root_document_id ?? o.quotation_id) as string | null;
    const doc = (root && latestByRoot.get(root)) || o.documents || {};
    const owner =
      ((doc.sales_owner_id ?? doc.created_by) as string | null) ?? null;
    if (!canSeeRecord(scope, { ownerId: owner, kind: "order" })) continue;
    const ctx = `${doc.affair_name || o.number} · ${doc.clients?.company_name ?? "—"}`;
    const amount = money(doc.total_price, doc.currency);
    const terminal = o.status === "delivered" || o.status === "cancelled";

    if (o.status === "awaiting_deposit") {
      // Factory validated + lead time set → next responsibility is Sales:
      // collect the customer deposit before production is released.
      const depositChips: ActionContextChip[] = [];
      if (doc.incoterm)
        depositChips.push({ label: "Incoterm", value: String(doc.incoterm) });
      if (o.created_at) {
        depositChips.push({
          label: "Order opened",
          value: fmtShortDate(o.created_at),
        });
      }
      signals.push({
        kind: "deposit", entityType: "production_order", entityId: o.id, ownerId: owner,
        ctx, since: o.created_at, amount,
        contextChips: depositChips,
      });
      continue; // Option A: no BL chase while still awaiting deposit.
    }
    if (!terminal && !(PRODUCTION_COMPLETED_STATUSES as string[]).includes(o.status)) {
      if (!o.current_production_deadline) {
        signals.push({
          kind: "missing_deadline", entityType: "production_order", entityId: o.id,
          ownerId: owner, ctx, since: o.created_at,
          contextChips: o.initial_production_deadline
            ? [
                {
                  label: "Initial baseline",
                  value: fmtShortDate(o.initial_production_deadline),
                },
              ]
            : [],
        });
      } else {
        // m072 — only the FACTORY portion of the slip drives the factory
        // chip / factory KPI (NULL-typed legacy rows are treated as
        // production). External delays (payment / shipping / client /
        // supplier / customs) never poison that attribution.
        const factorySlip = factoryDelayByOrder.get(String(o.id)) ?? 0;
        const overdueDays =
          new Date(o.current_production_deadline) < today
            ? ageDaysFrom(o.current_production_deadline) ?? 0
            : 0;
        // Alert-routing audit fix: ROUTING is broader than attribution.
        // A deadline pushed for ANY reason (total slip = current − initial),
        // or an order explicitly marked `production_delayed`, must reach the
        // deal owner — the client has to be informed regardless of who caused
        // the slip. Previously external-attributed slips and status-led
        // delays fired the bell (po.deadline_changed / po.status_changed)
        // but never produced an action item. The chips below keep the
        // factory/external attribution honest (m072 intact).
        const totalSlip = (() => {
          if (!o.initial_production_deadline || !o.current_production_deadline) return 0;
          const a = Date.parse(o.initial_production_deadline + "T00:00:00Z");
          const b = Date.parse(o.current_production_deadline + "T00:00:00Z");
          if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
          return Math.max(0, Math.round((b - a) / 86_400_000));
        })();
        const statusDelayed = o.status === "production_delayed";
        const lateBy = Math.max(
          factorySlip,
          overdueDays,
          totalSlip,
          statusDelayed ? 1 : 0
        );
        if (lateBy > 0) {
          // Card open age = when the first factory event landed (m073 stream).
          // For overdue-without-events orders, fall back to the deadline date.
          const earliestFactoryEvent = factoryEarliestByOrder.get(String(o.id));
          const since =
            earliestFactoryEvent ??
            (o.current_production_deadline as string) ??
            o.created_at;
          // Operational context chips — let the sales person inform the client
          // without opening the order first.
          const lateChips: ActionContextChip[] = [];
          if (o.initial_production_deadline) {
            lateChips.push({
              label: "Baseline",
              value: fmtShortDate(o.initial_production_deadline),
            });
          }
          if (o.current_production_deadline) {
            lateChips.push({
              label: "Now due",
              value: fmtShortDate(o.current_production_deadline),
              tone: "warn",
            });
          }
          // Attribution chips stay honest (m072): Factory shows only the
          // factory-attributed slip; External shows the rest; a status-led
          // declaration gets its own chip.
          if (factorySlip > 0) {
            lateChips.push({
              label: "Factory",
              value: `${factorySlip}d late`,
              tone: "danger",
            });
          }
          const externalSlip = Math.max(0, totalSlip - factorySlip);
          if (externalSlip > 0) {
            lateChips.push({
              label: "External",
              value: `${externalSlip}d late`,
              tone: "warn",
            });
          }
          if (statusDelayed) {
            lateChips.push({
              label: "Status",
              value: "Marked delayed",
              tone: "danger",
            });
          }
          signals.push({
            kind: "production_late", entityType: "production_order", entityId: o.id, ownerId: owner,
            ctx, ageDays: lateBy, since, amount,
            contextChips: lateChips,
            // A new delay event (any attribution) after a manual "Done"
            // resurfaces the card — the situation changed again.
            refreshedAt: latestChangeByOrder.get(String(o.id)) ?? null,
          });
        }
      }
    }

    // SENSOR: balance due / shipment blocked (alert-routing audit fix).
    // Both conditions previously existed ONLY as cockpit/table alerts
    // (computeOperationsAlert) — the bell could notify Sales while the
    // action area stayed empty. Both block execution, so both are urgent.
    if (!terminal && (PRODUCTION_COMPLETED_STATUSES as string[]).includes(o.status)) {
      // Balance outstanding — production done, money not in, shipment at risk.
      const expectedBalance = computeExpectedBalance(
        Number(doc.total_price ?? o.documents?.total_price ?? 0),
        ((doc.payment_mode ?? o.documents?.payment_mode ?? null) as PaymentMode | null),
        ((doc.payment_terms ?? o.documents?.payment_terms ?? null) as PaymentTerms | null)
      );
      const balanceReceived = Number(o.balance_received_amount ?? 0);
      if (expectedBalance > 0 && balanceReceived + 0.01 < expectedBalance) {
        const remaining = expectedBalance - balanceReceived;
        const balanceChips: ActionContextChip[] = [
          {
            label: "Outstanding",
            value: remaining.toLocaleString(undefined, { maximumFractionDigits: 0 }),
            tone: "danger",
          },
        ];
        if (o.actual_completion_date) {
          balanceChips.push({
            label: "Completed",
            value: fmtShortDate(o.actual_completion_date),
          });
        }
        signals.push({
          kind: "balance_due", entityType: "production_order", entityId: o.id, ownerId: owner,
          ctx, since: o.actual_completion_date ?? o.created_at, amount,
          contextChips: balanceChips,
        });
      }
      // Shipment blocked — factory done 7+ days, logistics hasn't moved.
      if (o.status === "production_completed" && !o.shipment_booked && o.actual_completion_date) {
        const idleDays = ageDaysFrom(o.actual_completion_date) ?? 0;
        if (idleDays >= 7) {
          signals.push({
            kind: "shipment_blocked", entityType: "production_order", entityId: o.id, ownerId: owner,
            ctx, ageDays: idleDays, since: o.actual_completion_date, amount,
            contextChips: [
              { label: "Completed", value: fmtShortDate(o.actual_completion_date) },
              { label: "Idle", value: `+${idleDays}d`, tone: "danger" },
            ],
          });
        }
      }
    }

    // BL / shipping confirmation — Option A: once the deposit is in (status
    // deposit_received+ OR ANY deposit amount recorded — robust to partial
    // deposits) and the SELLER manages destination shipping (CFR/CIF/DDP/DDU
    // or LCL). Prompts Sales to confirm the FULL BL/shipping details (consignee,
    // booking, docs — not just the port). Auto-clears once:
    //   - the shipment is booked / shipped / delivered (status-based), OR
    //   - the operator has actually filled out the BL info — consignee.company
    //     on the client's bl_profile, or bl_number / forwarder on the
    //     order's shipping_details. m075 fix: previously the card stayed visible
    //     after the user saved BL info, which made the dashboard noisy.
    const depositIn =
      BL_STAGE_STATUSES.has(o.status) || Number(o.deposit_received_amount ?? 0) > 0;
    const shippingDoneOrDead = ["shipment_booked", "shipped", "delivered", "cancelled"].includes(o.status);
    const blDocId = (doc.id ?? o.quotation_id) as string | null;
    const blClientId = (doc.client_id ?? o.documents?.client_id) as string | null;
    const blInfoFilled = blIsFilled(
      (doc.clients as any)?.bl_profile ?? null,
      (o.shipping_details as any) ?? null
    );
    if (
      depositIn &&
      !shippingDoneOrDead &&
      !blInfoFilled &&
      blRequired(doc.incoterm ?? null, doc.freight_type ?? null) &&
      blDocId
    ) {
      const blChips: ActionContextChip[] = [];
      if (doc.incoterm)
        blChips.push({ label: "Incoterm", value: String(doc.incoterm) });
      if (doc.port_of_destination)
        blChips.push({
          label: "Destination",
          value: String(doc.port_of_destination),
        });
      if (doc.freight_type)
        blChips.push({ label: "Freight", value: String(doc.freight_type) });
      signals.push({
        kind: "bl_missing_destination", entityType: "document", entityId: blDocId,
        ownerId: owner, ctx, since: o.created_at,
        contextChips: blChips,
        // Sales owns consignee/notify → land them on the client's BL profile
        // (the part most often incomplete after deposit). Fall back to the
        // quote's shipping section if the client isn't resolved.
        hrefOverride: blClientId
          ? `/clients/${blClientId}/edit?focus=bl`
          : `/documents/new?revise=${blDocId}&focus=shipping`,
      });
    }
  }

  // SENSOR: won deals with no task list yet — Sales action to kick off
  // production. Owner = sales_owner_id ?? created_by.
  const withTaskList = new Set(
    ((tlIdsRes.data ?? []) as any[]).map((r) => r.quotation_id).filter(Boolean)
  );
  for (const d of (wonRes.data ?? []) as any[]) {
    const owner = ((d.sales_owner_id ?? d.created_by) as string | null) ?? null;
    if (!canSeeRow(scope, owner)) continue;
    if (!withTaskList.has(d.id)) {
      signals.push({
        kind: "won_no_tasklist", entityType: "document", entityId: d.id, ownerId: owner,
        ctx: `${d.affair_name || d.number} · ${d.clients?.company_name ?? "—"}`,
        since: d.date, amount: money(d.total_price, d.currency),
      });
    }
  }

  // SENSOR: stalled accepted tenders (m110 critical rule) — an accepted
  // tender must NEVER sit without an upcoming next action. Fires when an
  // active-pipeline tender has no open planned action, or its earliest
  // open action is overdue. Soft-fails pre-m107/m110 (tables/columns
  // missing → no signals, the rest of the action center keeps working).
  {
    const ACTIVE_TENDER_STATUSES = [
      "accepted", "searching_partner", "partner_assigned", "contacted",
      "waiting_feedback", "interested", "quotation_requested",
    ];
    const { data: activeTenders, error: tErr } = await supabase
      .from("tenders")
      .select("id, title, country, owner_id, created_by, commercial_status, accepted_at, created_at, budget_usd")
      .in("commercial_status", ACTIVE_TENDER_STATUSES)
      .limit(500);
    if (!tErr && (activeTenders ?? []).length > 0) {
      const ids = (activeTenders ?? []).map((t: any) => t.id);
      const { data: tActions, error: aErr } = await supabase
        .from("planned_actions")
        .select("tender_id, due_date, done_at")
        .in("tender_id", ids)
        .is("done_at", null);
      if (!aErr) {
        const todayIso = new Date().toISOString().slice(0, 10);
        const earliestOpenByTender = new Map<string, string>();
        for (const a of (tActions ?? []) as any[]) {
          const cur = earliestOpenByTender.get(a.tender_id);
          if (!cur || a.due_date < cur) earliestOpenByTender.set(a.tender_id, a.due_date);
        }
        for (const t of (activeTenders ?? []) as any[]) {
          const owner = ((t.owner_id ?? t.created_by) as string | null) ?? null;
          if (!canSeeRow(scope, owner)) continue;
          const earliest = earliestOpenByTender.get(t.id);
          const overdue = !!earliest && earliest < todayIso;
          if (earliest && !overdue) continue; // has an upcoming action — fine
          signals.push({
            kind: "tender_stalled", entityType: "tender", entityId: t.id, ownerId: owner,
            ctx: `${t.title} · ${t.country ?? "—"}`,
            since: t.accepted_at ?? t.created_at,
            ageDays: overdue
              ? ageDaysFrom(earliest) ?? 0
              : ageDaysFrom(t.accepted_at ?? t.created_at) ?? 0,
            amount: t.budget_usd ? { value: Number(t.budget_usd), currency: "USD" } : null,
            contextChips: overdue
              ? [{ label: "Next action", value: `overdue ${earliest}`, tone: "danger" }]
              : [{ label: "Next action", value: "none planned", tone: "danger" }],
          });
        }
      }
    }
  }

  return signals;
}

async function gatherInfoItems(supabase: SupabaseClient): Promise<ActionItem[]> {
  const { data, error } = await supabase
    .from("events")
    .select("id, entity_type, entity_id, event_type, message, created_at")
    .in("event_type", ["tl.validated", "tl.production_ready", "po.production_completed", "po.shipment_updated"])
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) return [];
  return ((data ?? []) as any[]).map((e) =>
    materialize({
      kind: "info",
      entityType: (e.entity_type as EventEntityType) === "client" ? "client"
        : e.entity_type === "production_order" ? "production_order"
        : e.entity_type === "task_list" ? "task_list" : "document",
      entityId: e.entity_id,
      ownerId: null,
      ctx: e.message ?? "",
      since: e.created_at,
      titleOverride: eventTypeLabel(e.event_type),
      idOverride: `info:${e.id}`,
    })
  );
}

/* ===================== Cross-cutting: role filter + ack state ===================== */

function viewerScope(role: Role | null): { all: boolean; set: Set<ActionRole> } {
  if (role === "admin" || role === "super_admin") return { all: true, set: new Set() };
  if (role === "task_list_manager") return { all: false, set: new Set<ActionRole>(["task_list_manager"]) };
  if (role === "operations") return { all: false, set: new Set<ActionRole>(["operations"]) };
  return { all: false, set: new Set<ActionRole>(["sales"]) };
}

/** Keep only items meant for this viewer's role (management sees all). */
function filterByRole(items: ActionItem[], role: Role | null): ActionItem[] {
  const vs = viewerScope(role);
  return vs.all ? items : items.filter((it) => it.roles.some((r) => vs.set.has(r)));
}

/**
 * Apply acknowledgement state (m069): drop "done" items, stamp acknowledger on
 * acknowledged ones. Defensive — returns items untouched if the table/column
 * isn't there yet.
 */
async function applyAcks(supabase: SupabaseClient, items: ActionItem[]): Promise<ActionItem[]> {
  if (items.length === 0) return items;
  const keys = items.map((i) => i.id);

  let rows: any[] | null = null;
  const withState = await supabase
    .from("action_acks")
    .select("action_key, state, acknowledged_by, acknowledged_at")
    .in("action_key", keys);
  if (!withState.error) {
    rows = withState.data ?? [];
  } else {
    const noState = await supabase
      .from("action_acks")
      .select("action_key, acknowledged_by, acknowledged_at")
      .in("action_key", keys);
    if (!noState.error) rows = (noState.data ?? []).map((r: any) => ({ ...r, state: "acknowledged" }));
  }
  if (!rows) return items;

  const byKey = new Map<string, any>();
  for (const r of rows) byKey.set(r.action_key, r);
  const names = await resolveUserLabelStrings(
    rows.map((r) => r.acknowledged_by).filter((x): x is string => !!x)
  );

  const out: ActionItem[] = [];
  for (const it of items) {
    const a = byKey.get(it.id);
    if (a?.state === "done") {
      // Alert-routing audit fix: a manual "Done" used to hide the card
      // FOREVER (the ack key has no notion of the condition evolving), so
      // an order whose delay kept growing never resurfaced. Now: if the
      // underlying condition changed AFTER the Done (refreshedAt newer than
      // acknowledged_at), the card comes back — fresh, without the stale
      // ack badge. Otherwise it stays handled.
      const resurfaced =
        !!it.refreshedAt &&
        !!a.acknowledged_at &&
        String(it.refreshedAt) > String(a.acknowledged_at);
      if (!resurfaced) continue;
      out.push(it);
      continue;
    }
    if (a) {
      it.acknowledgedAt = a.acknowledged_at;
      it.acknowledgedByName = a.acknowledged_by ? names.get(a.acknowledged_by) ?? null : null;
    }
    out.push(it);
  }
  return out;
}

/**
 * Attach the micro-notes pinned to each action item (m075). Single batched
 * query keyed by the visible action_keys, grouped client-side. Soft-fails
 * silently if `action_notes` isn't migrated yet — never blocks the dashboard.
 */
async function attachNotes(
  supabase: SupabaseClient,
  items: ActionItem[]
): Promise<ActionItem[]> {
  if (items.length === 0) return items;
  // Notes ARE the canonical per-entity conversation (entity_messages), so every
  // card about the same order/project shows one shared operational-memory
  // thread — the same notes that appear in the conversation drawer + the bell.
  const entityIds = Array.from(
    new Set(items.map((i) => i.entityId).filter((x): x is string => !!x))
  );
  if (entityIds.length === 0) return items;
  const { data, error } = await supabase
    .from("entity_messages")
    .select("id, entity_type, entity_id, user_id, message, created_at")
    .eq("message_kind", "comment")
    .in("entity_id", entityIds)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) return items; // m049 not applied → quietly skip
  const rows = (data ?? []) as any[];

  const authorIds = Array.from(
    new Set(rows.map((r) => r.user_id).filter((x): x is string => !!x))
  );
  const names = await resolveUserLabelStrings(authorIds);

  const byEntity = new Map<string, ActionNote[]>();
  for (const r of rows) {
    const k = `${r.entity_type}:${r.entity_id}`;
    if (!byEntity.has(k)) byEntity.set(k, []);
    byEntity.get(k)!.push({
      id: r.id,
      body: r.message ?? "",
      createdAt: r.created_at,
      createdBy: r.user_id ?? null,
      authorLabel: r.user_id
        ? names.get(r.user_id) ?? String(r.user_id).slice(0, 8)
        : "—",
    });
  }
  for (const it of items) {
    // Match by entity so different card kinds on the same order share notes.
    const list = byEntity.get(`${it.entityType}:${it.entityId}`);
    if (list && list.length > 0) {
      // Cap the inline preview to keep cards readable; full history lives in
      // the entity's conversation drawer.
      it.notes = list.slice(0, 5);
      it.noteCount = list.length;
    }
  }
  return items;
}

/* ===================== Classic (section) view ===================== */

export type ActionCenterData = {
  sections: Record<ActionSection, ActionItem[]>;
  total: number;
  urgentCount: number;
};

function emptySectionData(): ActionCenterData {
  return { sections: { urgent: [], waiting_me: [], waiting_client: [], info_missing: [] }, total: 0, urgentCount: 0 };
}

/** Classic dashboard — groups by section (role-filtered + ack-aware).
 *
 * `opts.includeNotes` (default true) attaches the per-card note previews via a
 * further entity_messages + name-resolution read. That data is PURELY
 * presentational (noteCount + inline preview) and is only rendered by the
 * Operations tab / operations-v2. When the caller only needs the sections +
 * counts (e.g. the Sales tab, which uses this solely for the "ops urgent"
 * badge number), pass `includeNotes: false` to skip ~3 round-trips — the
 * sections, membership and counts are byte-for-byte identical either way. */
export async function getOperationsActions(
  userId: string | null,
  role: Role | null,
  opts?: { includeNotes?: boolean }
): Promise<ActionCenterData> {
  if (!userId) return emptySectionData();
  const includeNotes = opts?.includeNotes ?? true;
  const supabase = createClient();
  // PERF (2026-07-11): don't await the scope here — hand the promise to
  // gatherSignals so the access_grants read overlaps its main data wave.
  const scopePromise = getVisibilityScope(userId, role);
  const signals = await gatherSignals(supabase, scopePromise);
  const acked = await applyAcks(supabase, filterByRole(signals.map(materialize), role));
  const items = includeNotes ? await attachNotes(supabase, acked) : acked;

  const data = emptySectionData();
  for (const it of items) data.sections[it.section].push(it);
  for (const s of ACTION_SECTION_ORDER) {
    data.sections[s].sort((a, b) => b.priority - a.priority || (b.ageDays ?? 0) - (a.ageDays ?? 0));
  }
  data.total = items.length;
  data.urgentCount = data.sections.urgent.length;
  return data;
}

/* ===================== V2 (behavior) view ===================== */

export { DOC_ACTIVE_STATUSES };
