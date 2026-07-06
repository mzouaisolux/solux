// =====================================================================
// DASHBOARD — Phase 2 (locked spec PLAN_CRM_SOLUX §11 étape 2).
//
// "Le Dashboard n'est pas une destination. C'est une COUCHE DE
// ROUTAGE." One question: what do I have to do today? Two tabs
// (SALES / OPERATIONS), three buckets each, always in this order:
// Critical → Due Today → Preventive.
//
//   Rule 1  Critical first, always.
//   Rule 2  Every item is actionable: direct link + inline Done where
//           possible. An item you can't act on doesn't render.
//   Rule 3  Each tab badge shows the OTHER tab's unresolved criticals.
//   Rule 4  Ownership filter on both tabs: My Items (default) / All
//           Items — owner ?? creator. Contributors see themselves.
//   Rule 5  Max 5 items per block + "View all →" (in-place expand).
//   Rule 6  Empty states are success states.
//
// SALES tab: routing-layer buckets per the locked spec. My Morning is
// merged here (/morning redirects). Sales analytics live in /business.
//
// OPERATIONS tab: restored EXACTLY as the pre-Phase-2 dashboard
// (owner ruling 2026-06-13) — see OperationsTab.tsx. We'll iterate on
// it WITH the owner before removing anything.
//
// Item computation lives in lib/dashboard-items.ts (pure, tested) and
// lib/action-center.ts — this page only queries rows and renders.
// The preventive window is the m120 admin setting (default 7 days).
// =====================================================================

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveRole } from "@/lib/auth";
import { isTechnicalRole } from "@/lib/types";
import { hasUiCapability } from "@/lib/permissions";
import { getOperationsActions } from "@/lib/action-center";
import { OperationsTab } from "./OperationsTab";
import { ActionCenter } from "./ActionCenter";
import {
  buildSalesItems,
  LIVE_AFFAIR_STATUSES,
  ACTIVE_SENT_STATUSES,
  type SalesItem,
} from "@/lib/dashboard-items";
import {
  getNumberSetting,
  PREVENTIVE_DAYS_KEY,
  PREVENTIVE_DAYS_DEFAULT,
} from "@/lib/app-settings";
import { chunkByUrlBudget } from "@/lib/attribution-parse";
import { completePlannedAction } from "@/app/(app)/affairs/actions";
import { markReminderDone } from "@/app/(app)/documents/[id]/reminder-actions";
import { getT } from "@/lib/i18n/server";
import type { TFunction } from "@/lib/i18n";
import { enableQueryProfiling, profStep, profMark } from "@/lib/dash-profile";

enableQueryProfiling(); // TEMP perf: no-op unless DASH_PROFILE is set

export const dynamic = "force-dynamic";

const BLOCK_CAP = 5; // Rule 5

const KIND_CHIP: Record<SalesItem["kind"], { labelKey: string; cls: string }> = {
  action_overdue: { labelKey: "dashboard.chip.overdue", cls: "bg-rose-50 text-rose-700 border-rose-200" },
  reminder_overdue: { labelKey: "dashboard.chip.reminder", cls: "bg-rose-50 text-rose-700 border-rose-200" },
  no_next_action: { labelKey: "dashboard.chip.no_next_action", cls: "bg-rose-50 text-rose-700 border-rose-200" },
  blocked_quote: { labelKey: "dashboard.chip.blocked_quote", cls: "bg-rose-50 text-rose-700 border-rose-200" },
  action_today: { labelKey: "dashboard.chip.today", cls: "bg-neutral-100 text-neutral-700 border-neutral-200" },
  reminder_today: { labelKey: "dashboard.chip.reminder", cls: "bg-neutral-100 text-neutral-700 border-neutral-200" },
  quote_no_reply: { labelKey: "dashboard.chip.no_reply", cls: "bg-amber-50 text-amber-800 border-amber-200" },
  parked_affair: { labelKey: "dashboard.chip.parked", cls: "bg-amber-50 text-amber-800 border-amber-200" },
};

function SalesRow({ item, t }: { item: SalesItem; t: TFunction }) {
  const chip = KIND_CHIP[item.kind];
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2">
      <span className="min-w-0 text-[13px]">
        <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${chip.cls}`}>
          {t(chip.labelKey)}
        </span>{" "}
        <Link
          href={item.href}
          className="font-medium text-neutral-900 underline decoration-dotted underline-offset-2 hover:text-neutral-600"
        >
          {item.title}
        </Link>
        {item.subtitle && <span className="text-neutral-400"> · {item.subtitle}</span>}
        {item.dueDate && item.kind !== "no_next_action" && (
          <span className={item.bucket === "critical" ? "font-semibold text-rose-700" : "text-neutral-400"}>
            {" "}· {item.dueDate}
          </span>
        )}
      </span>
      <span className="flex items-center gap-2">
        {item.actionId && item.affairId && (
          <form action={completePlannedAction}>
            <input type="hidden" name="id" value={item.actionId} />
            <input type="hidden" name="affair_id" value={item.affairId} />
            <button className="rounded border border-neutral-300 px-2 py-0.5 text-[11px] font-semibold text-neutral-800 hover:bg-neutral-50">
              ✓ {t("action.done")}
            </button>
          </form>
        )}
        {item.reminderId && (
          <form action={markReminderDone}>
            <input type="hidden" name="id" value={item.reminderId} />
            <button className="rounded border border-neutral-300 px-2 py-0.5 text-[11px] font-semibold text-neutral-800 hover:bg-neutral-50">
              ✓ {t("action.done")}
            </button>
          </form>
        )}
        <Link
          href={item.href}
          className="rounded border border-neutral-200 px-2 py-0.5 text-[11px] font-semibold text-neutral-600 hover:bg-neutral-50"
        >
          {t("action.open_arrow")}
        </Link>
      </span>
    </li>
  );
}

/** Rule 5 + Rule 6 wrapper: cap at 5, in-place "View all", success empty state. */
function Bucket({
  title,
  tone,
  count,
  emptyText,
  expandHref,
  expanded,
  children,
  t,
}: {
  title: string;
  tone: "critical" | "today" | "preventive";
  count: number;
  emptyText: string;
  expandHref: string;
  expanded: boolean;
  children: React.ReactNode;
  t: TFunction;
}) {
  const toneCls =
    tone === "critical"
      ? count > 0
        ? "ring-1 ring-rose-200"
        : ""
      : "";
  const titleCls =
    tone === "critical" && count > 0 ? "text-rose-700" : "text-neutral-500";
  return (
    <section className={`panel p-5 ${toneCls}`}>
      <div className="flex items-center justify-between gap-2">
        <div className={`text-[11px] font-semibold uppercase tracking-wider ${titleCls}`}>
          {title}
          {count > 0 && <span className="ml-2 rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] text-neutral-700">{count}</span>}
        </div>
        {count > BLOCK_CAP && !expanded && (
          <Link href={expandHref} className="text-[11px] font-semibold text-neutral-500 hover:text-neutral-900">
            {t("dashboard.view_all_n", { n: count })}
          </Link>
        )}
      </div>
      {count === 0 ? (
        <p className="mt-2 text-[13px] text-emerald-700">✓ {emptyText}</p>
      ) : (
        <div className="mt-1">{children}</div>
      )}
    </section>
  );
}

export default async function HomeDashboardPage({
  searchParams,
}: {
  searchParams?: { tab?: string; scope?: string; x?: string };
}) {
  const supabase = createClient();
  const { userId, effectiveRole } = await getEffectiveRole();
  const t = getT();

  // Rule 4 — contributors see themselves; managers/directors can widen.
  const canSeeAll = isTechnicalRole(effectiveRole) || effectiveRole === "sales_director";
  const scope = canSeeAll && searchParams?.scope === "all" ? "all" : "my";
  const scopeUserId = scope === "all" ? null : userId;

  const defaultTab =
    effectiveRole === "task_list_manager" || effectiveRole === "operations"
      ? "operations"
      : "sales";
  const tab =
    searchParams?.tab === "operations" || searchParams?.tab === "sales"
      ? searchParams.tab
      : defaultTab;
  const expanded = searchParams?.x ?? null;
  const qs = (over: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const merged = { tab, scope, x: null as string | null, ...over };
    if (merged.tab) p.set("tab", merged.tab);
    if (merged.scope === "all") p.set("scope", "all");
    if (merged.x) p.set("x", merged.x);
    const s = p.toString();
    return s ? `/dashboard?${s}` : "/dashboard";
  };

  const today = new Date().toISOString().slice(0, 10);

  profMark("LOAD START");

  // ---- ONE parallel wave (perf rule from the 2026-06-12 pass) ----
  const [
    actionData,
    preventiveDays,
    canCreateQuotation,
    actionsRes,
    affairsRes,
    remindersRes,
    sentDocsRes,
    userRes,
    profileRes,
  ] = await profStep("parallel-wave (9 sources)", () => Promise.all([
    getOperationsActions(userId, effectiveRole),
    getNumberSetting(supabase, PREVENTIVE_DAYS_KEY, PREVENTIVE_DAYS_DEFAULT),
    hasUiCapability("quotation.create"),
    supabase
      .from("planned_actions")
      .select(
        "id, affair_id, tender_id, action_type, title, due_date, affairs:affair_id(id, name, status, archived_at, owner_id, created_by, clients:client_id(company_name)), tenders:tender_id(id, title, owner_id)"
      )
      .is("done_at", null)
      .order("due_date", { ascending: true }),
    supabase
      .from("affairs")
      .select("id, name, status, owner_id, created_by, archived_at, clients:client_id(company_name)")
      .in("status", LIVE_AFFAIR_STATUSES as unknown as string[])
      .is("archived_at", null),
    supabase
      .from("quotation_reminders")
      .select("id, user_id, document_id, remind_at, status, note, documents:document_id(number)")
      .eq("status", "open"),
    supabase
      .from("documents")
      .select(
        "id, number, status, total_price, currency, date, created_by, sales_owner_id, affair_id, root_document_id, version, archived_at"
      )
      .in("status", ACTIVE_SENT_STATUSES as unknown as string[])
      .is("archived_at", null),
    supabase.auth.getUser(),
    supabase.from("user_profiles").select("user_id, display_name").eq("user_id", userId).maybeSingle(),
  ]));

  // Quote FAMILIES: the latest version decides whether a quote is still
  // an active sent one — fetch every doc of the candidate families
  // (chunked .in(): title-keys taught us the URL-budget lesson).
  const sentDocs = (sentDocsRes.data ?? []) as any[];
  const roots = [...new Set(sentDocs.map((d) => d.root_document_id ?? d.id))] as string[];
  const familyDocs: any[] = [...sentDocs];
  const seenDocIds = new Set(sentDocs.map((d) => d.id));
  const chunks = chunkByUrlBudget(roots, 6000, 60);
  await profStep(`quote-family loop (${chunks.length} sequential chunks, ${roots.length} roots)`, async () => {
    for (const chunk of chunks) {
      const list = chunk.join(",");
      const { data } = await supabase
        .from("documents")
        .select(
          "id, number, status, total_price, currency, date, created_by, sales_owner_id, affair_id, root_document_id, version, archived_at"
        )
        .or(`root_document_id.in.(${list}),id.in.(${list})`);
      for (const d of (data ?? []) as any[]) {
        if (!seenDocIds.has(d.id)) {
          seenDocIds.add(d.id);
          familyDocs.push(d);
        }
      }
    }
  });

  // ---- compute the buckets (pure libs) ----
  const sales = await profStep("buildSalesItems (pure JS)", () => buildSalesItems({
    actions: ((actionsRes.data ?? []) as any[]).filter((a) => a.affairs || a.tenders),
    affairs: (affairsRes.data ?? []) as any[],
    quoteFamilyDocs: familyDocs,
    reminders: (remindersRes.data ?? []) as any[],
    today,
    preventiveDays,
    scopeUserId,
  }));

  profMark("LOAD END (data ready, rendering)");

  // Rule 3 — cross-tab urgency badges (ops = Action Center "urgent").
  const salesCritCount = sales.critical.length;
  const opsCritCount = (actionData.sections.urgent ?? []).length;

  // Greet by real name (profile display name → first word), never the raw
  // email login (the "Good day, Testsales" tell).
  const displayName = ((profileRes.data as any)?.display_name as string | undefined)?.trim();
  const greetingName = displayName
    ? displayName.split(/\s+/)[0]
    : userRes.data.user?.email
      ? userRes.data.user.email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
      : "there";

  const capSales = (items: SalesItem[], key: string) =>
    expanded === key ? items : items.slice(0, BLOCK_CAP);

  const TabLink = ({ id, label, crit }: { id: string; label: string; crit: number }) => (
    <Link
      href={qs({ tab: id })}
      className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[13px] font-semibold ${
        tab === id
          ? "bg-neutral-900 text-white"
          : "border border-neutral-200 text-neutral-600 hover:bg-neutral-50"
      }`}
    >
      {label}
      {crit > 0 && (
        <span
          className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold ${
            tab === id ? "bg-rose-500 text-white" : "bg-rose-100 text-rose-700"
          }`}
          title={`${crit} critical item${crit > 1 ? "s" : ""}`}
        >
          {crit}
        </span>
      )}
    </Link>
  );

  return (
    <div className="mx-auto max-w-screen-xl px-6 py-8 space-y-5">
      {/* header — greeting + the one question */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="eyebrow">{t("dashboard.eyebrow")}</div>
          <h1 className="doc-title">{t("dashboard.greeting", { name: greetingName })}</h1>
          <p className="mt-1 text-sm text-neutral-500">Your actions first — pipeline and analysis are below.</p>
        </div>
        <div className="flex items-center gap-2">
          {canSeeAll && (
            <span className="flex items-center rounded-full border border-neutral-200 p-0.5 text-[12px] font-semibold">
              <Link
                href={qs({ scope: "my" })}
                className={`rounded-full px-3 py-1 ${scope === "my" ? "bg-neutral-900 text-white" : "text-neutral-500 hover:text-neutral-900"}`}
              >
                {t("dashboard.scope.my")}
              </Link>
              <Link
                href={qs({ scope: "all" })}
                className={`rounded-full px-3 py-1 ${scope === "all" ? "bg-neutral-900 text-white" : "text-neutral-500 hover:text-neutral-900"}`}
              >
                {t("dashboard.scope.all")}
              </Link>
            </span>
          )}
          {canCreateQuotation && (
            <>
              {/* Client creation is the most frequent sales action — give it a
                  direct, one-click entry point right beside New quotation
                  (was menu-only). Deep-links to the F6-proven ?new=1 modal.
                  Same audience as the quote CTA (sales-oriented roles); other
                  roles keep the mega-menu path and an uncluttered dashboard. */}
              <Link
                href="/clients?new=1"
                className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-[13px] font-semibold text-neutral-800 hover:bg-neutral-50"
              >
                {t("dashboard.new_client")}
              </Link>
              <Link
                href="/documents/new"
                className="rounded-lg bg-neutral-900 px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-neutral-700"
              >
                {t("dashboard.new_quotation")}
              </Link>
            </>
          )}
        </div>
      </div>

      {/* Sprint 1 — action-first hero: what only you can move forward today. */}
      <ActionCenter role={effectiveRole ?? ""} />

      {/* tabs — Rule 3: the badge tells you the other tab burns */}
      <div className="flex items-center gap-2">
        <TabLink id="sales" label={t("dashboard.tab.sales")} crit={salesCritCount} />
        <TabLink id="operations" label={t("dashboard.tab.operations")} crit={opsCritCount} />
      </div>

      {tab === "sales" ? (
        <div className="space-y-4">
          <Bucket
            title="Needs attention — plan a next step"
            tone="today"
            count={sales.critical.length}
            emptyText={t("dashboard.empty.sales_critical")}
            expandHref={qs({ x: "sc" })}
            expanded={expanded === "sc"}
            t={t}
          >
            <ul className="divide-y divide-neutral-100">
              {capSales(sales.critical, "sc").map((i) => (
                <SalesRow key={i.id} item={i} t={t} />
              ))}
            </ul>
          </Bucket>
          <Bucket
            title={t("dashboard.bucket.due_today")}
            tone="today"
            count={sales.dueToday.length}
            emptyText={t("dashboard.empty.sales_today")}
            expandHref={qs({ x: "st" })}
            expanded={expanded === "st"}
            t={t}
          >
            <ul className="divide-y divide-neutral-100">
              {capSales(sales.dueToday, "st").map((i) => (
                <SalesRow key={i.id} item={i} t={t} />
              ))}
            </ul>
          </Bucket>
          <Bucket
            title={t("dashboard.bucket.preventive", { days: preventiveDays })}
            tone="preventive"
            count={sales.preventive.length}
            emptyText={t("dashboard.empty.sales_preventive")}
            expandHref={qs({ x: "sp" })}
            expanded={expanded === "sp"}
            t={t}
          >
            <ul className="divide-y divide-neutral-100">
              {capSales(sales.preventive, "sp").map((i) => (
                <SalesRow key={i.id} item={i} t={t} />
              ))}
            </ul>
          </Bucket>
        </div>
      ) : (
        /* OPERATIONS — restored pre-Phase-2 dashboard, verbatim. */
        <OperationsTab actionData={actionData} />
      )}
    </div>
  );
}
