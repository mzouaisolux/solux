import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { hasUiCapability } from "@/lib/permissions";

// =====================================================================
// Action Center (Sprint 1) — the role-aware "what only I can move forward
// today" hero. One philosophy: when you log in you immediately see
//   1) what REQUIRES your action  →  big, with a one-click CTA
//   2) what is WAITING on others  →  quiet, no action needed yet
// Computed straight from the workflow tables (RLS scopes visibility to
// the signed-in user), so it never shows another role's queue.
// =====================================================================

type Item = { id: string; title: string; subtitle: string | null; href: string; cta: string };
type Group = { key: string; title: string; items: Item[] };

/** Pre-computed view model: the fetch + assembly result, ready to render. */
export type ActionCenterView = {
  actGroups: Group[];
  waitGroups: Group[];
  actTotal: number;
};

const company = (r: any): string | null => r?.clients?.company_name ?? null;

/**
 * PERF (2026-07-11 Phase 2): data-fetching lifted OUT of the render so the page
 * can run it INSIDE its parallel-wave (Promise.all) instead of as a serial 3rd
 * phase after the page's own await. Same queries, same gates, same assembly —
 * only the timing changes. <ActionCenter/> below is now pure presentation.
 */
export async function loadActionCenterData(
  role: string,
  superAdmin = false
): Promise<ActionCenterView> {
  const supabase = createClient();
  const isDir = role === "sales_director" || role === "admin" || superAdmin;
  // A pure Sales Director supervises — their action queue is approvals + pricing,
  // NOT submitting drafts / launching production (those belong to the rep who
  // owns the deal). Admins see everything.
  const isSales = role === "sales" || role === "admin" || superAdmin;

  // PERF (2026-07-11 perf pass): resolve ALL capability gates first — they're
  // memoised (React cache + 30s TTL in lib/permissions), so this is one shared
  // role_permissions read, not three. Capability-gated (NOT raw role): the
  // "needs your review" / cost / logistics queues are ACTION queues, shown only
  // to roles that can actually act on them. View-As faithful; admin/super_admin
  // keep them (their matrix grants the capability).
  const [canReviewTaskLists, canEnterCost, canEnterLogistics] = await Promise.all([
    hasUiCapability("task_list.validate"),
    hasUiCapability("project.enter_cost"),
    hasUiCapability("project.enter_logistics"),
  ]);

  const act: Group[] = [];
  const waiting: Group[] = [];

  // PERF: every queue below is INDEPENDENT — fire them all in ONE parallel wave
  // instead of the previous four sequential waves (isDir → review → cost →
  // logistics → sales). Identical queries, gates and assembly order; just
  // concurrent. A false gate leaves its slot `undefined` (no query issued), so
  // behaviour — including which rows a role sees — is byte-for-byte unchanged.
  // Ordered project_requests projection reused by the approve/price/cost/
  // logistics queues (all share the same shape + updated_at ordering).
  const prOrdered = (status: string) =>
    supabase
      .from("project_requests")
      .select("id, name, clients:client_id(company_name)")
      .eq("status", status)
      .is("archived_at", null)
      .order("updated_at", { ascending: true });

  // PERF (2026-07-11 Phase 2, Step C): the review queue (under_validation task
  // lists) and the "which affairs already have a task list" Set used to be TWO
  // separate production_task_lists reads (toReview + tlAffairs). They're now ONE
  // read (allTaskListsRes), derived in JS below. Fewer queries = less pressure
  // on the remote pool (the ceiling we measured). Runs whenever EITHER consumer
  // needs it; behaviour is identical (same rows, same order, same Set).
  const needTaskLists = canReviewTaskLists || isSales;
  const [
    toApprove, // isDir
    toPrice, // isDir
    allTaskListsRes, // canReviewTaskLists || isSales — feeds review queue + affair Set
    toCost, // canEnterCost
    toLogistics, // canEnterLogistics
    priced, // isSales
    drafts, // isSales
    wonQuotes, // isSales
    inProgress, // isSales
    sentQuotes, // isSales
  ] = await Promise.all([
    isDir ? prOrdered("waiting_director_approval") : undefined,
    isDir ? prOrdered("ready_for_pricing") : undefined,
    needTaskLists
      ? supabase.from("production_task_lists").select("id, number, status, affair_id, clients:client_id(company_name)").order("submitted_at", { ascending: true })
      : undefined,
    canEnterCost ? prOrdered("waiting_factory_cost") : undefined,
    canEnterLogistics ? prOrdered("waiting_logistics") : undefined,
    // NOTE: priced/drafts intentionally have NO .order() — kept exactly as the
    // original so row order in the UI is preserved.
    isSales ? supabase.from("project_requests").select("id, name, clients:client_id(company_name)").eq("status", "priced").is("archived_at", null) : undefined,
    isSales ? supabase.from("project_requests").select("id, name, clients:client_id(company_name)").eq("status", "draft").is("archived_at", null) : undefined,
    isSales ? supabase.from("documents").select("id, number, affair_id, clients:client_id(company_name)").eq("type", "quotation").eq("status", "won").is("archived_at", null) : undefined,
    isSales ? supabase.from("project_requests").select("id, name, status, clients:client_id(company_name)").in("status", ["waiting_director_approval", "waiting_factory_cost", "waiting_logistics", "ready_for_pricing"]).is("archived_at", null) : undefined,
    isSales ? supabase.from("documents").select("id, number, date, clients:client_id(company_name)").eq("type", "quotation").in("status", ["sent", "negotiating"]).is("archived_at", null) : undefined,
  ]);

  // Rows shared by the review queue + the affair-has-task-list Set (Step C).
  const allTaskListRows = (allTaskListsRes?.data ?? []) as any[];

  // ---- assemble in the SAME order the sequential version produced ----
  // Director: approvals + pricing.
  if (toApprove) act.push({ key: "approve", title: "Service requests to approve", items: ((toApprove.data ?? []) as any[]).map((r) => ({ id: r.id, title: r.name ?? "Service request", subtitle: company(r), href: `/projects/${r.id}`, cta: "Review →" })) });
  if (toPrice) act.push({ key: "price", title: "Price requests — set margins", items: ((toPrice.data ?? []) as any[]).map((r) => ({ id: r.id, title: r.name ?? "Service request", subtitle: company(r), href: `/projects/${r.id}`, cta: "Set pricing →" })) });
  // Reviewers (task_list.validate): task lists awaiting validation. Derived from
  // the shared read — filter to under_validation (submitted_at order preserved).
  if (canReviewTaskLists) {
    const reviewRows = allTaskListRows.filter((r) => r.status === "under_validation");
    act.push({ key: "review", title: "Task lists — needs your review", items: reviewRows.map((r) => ({ id: r.id, title: r.number ?? "Task list", subtitle: company(r), href: `/task-lists/${r.id}`, cta: "Review →" })) });
  }
  // Operations: service requests waiting on THEIR numbers (E2E audit 2026-07-10, BUG-3).
  if (toCost) act.push({ key: "cost", title: "Factory costs to enter", items: ((toCost.data ?? []) as any[]).map((r) => ({ id: r.id, title: r.name ?? "Service request", subtitle: company(r), href: `/projects/${r.id}`, cta: "Enter cost →" })) });
  if (toLogistics) act.push({ key: "logistics", title: "Packing & freight to enter", items: ((toLogistics.data ?? []) as any[]).map((r) => ({ id: r.id, title: r.name ?? "Service request", subtitle: company(r), href: `/projects/${r.id}`, cta: "Enter logistics →" })) });

  // Sales: their workflow moves (generate quote / launch / submit).
  if (isSales) {
    const tlAffairSet = new Set(allTaskListRows.map((t) => t.affair_id).filter(Boolean));
    // A won quotation whose affair has no task list yet = not launched.
    const readyLaunch = ((wonQuotes?.data ?? []) as any[]).filter((d) => !d.affair_id || !tlAffairSet.has(d.affair_id));

    act.push({ key: "gen", title: "Ready to generate quotation", items: ((priced?.data ?? []) as any[]).map((r) => ({ id: r.id, title: r.name ?? "Service request", subtitle: company(r), href: `/projects/${r.id}`, cta: "Generate →" })) });
    act.push({ key: "launch", title: "Won — ready to launch production", items: readyLaunch.map((d) => ({ id: d.id, title: d.number ?? "Quotation", subtitle: company(d), href: `/documents/${d.id}`, cta: "Launch →" })) });
    act.push({ key: "drafts", title: "Draft service requests — submit or edit", items: ((drafts?.data ?? []) as any[]).map((r) => ({ id: r.id, title: r.name ?? "Service request", subtitle: company(r), href: `/projects/${r.id}`, cta: "Open →" })) });
    waiting.push({ key: "waitprice", title: "Waiting for pricing", items: ((inProgress?.data ?? []) as any[]).map((r) => ({ id: r.id, title: r.name ?? "Service request", subtitle: company(r), href: `/projects/${r.id}`, cta: "View" })) });
    waiting.push({ key: "waitreply", title: "Quotations awaiting customer reply", items: ((sentQuotes?.data ?? []) as any[]).map((d) => ({ id: d.id, title: d.number ?? "Quotation", subtitle: company(d), href: `/documents/${d.id}`, cta: "View" })) });
  }

  const actGroups = act.filter((g) => g.items.length > 0);
  const waitGroups = waiting.filter((g) => g.items.length > 0);
  const actTotal = actGroups.reduce((n, g) => n + g.items.length, 0);
  return { actGroups, waitGroups, actTotal };
}

/**
 * Async component — fetches its own data in ITS OWN render phase.
 *
 * PERF NOTE (2026-07-11 Phase 2, MEASURED): we tried lifting this fetch into the
 * page's parallel-wave (~20 concurrent queries). It REGRESSED — the remote
 * Supabase pool saturates past ~10-15 concurrent queries, so every query slowed
 * (cumulative DB time +46%). Keeping the Action Center as its own wave (~11
 * queries) stays under the pool's comfortable width. Lesson: with a pooled
 * remote DB, concurrency width has an optimum — wider is not faster.
 */
export async function ActionCenter({
  role,
  superAdmin = false,
}: {
  role: string;
  superAdmin?: boolean;
}) {
  const { actGroups, waitGroups, actTotal } = await loadActionCenterData(role, superAdmin);
  if (actGroups.length === 0 && waitGroups.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[15px] font-semibold text-neutral-900">
          {actTotal > 0 ? "Needs your action" : "Nothing needs your action right now"}
          {actTotal > 0 && (
            <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-neutral-900 px-1.5 text-[11px] font-bold text-white">{actTotal}</span>
          )}
        </h2>
      </div>

      {actGroups.length === 0 ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3 text-sm text-emerald-800">
          ✓ You&apos;re all caught up — nothing is waiting on you.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {actGroups.map((g) => (
            <div key={g.key} className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-[13px] font-semibold uppercase tracking-wide text-neutral-500">{g.title}</h3>
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-100 px-1.5 text-[11px] font-bold text-amber-800">{g.items.length}</span>
              </div>
              <ul className="divide-y divide-neutral-100">
                {g.items.slice(0, 5).map((it) => (
                  <li key={it.id} className="flex items-center justify-between gap-3 py-2">
                    <Link href={it.href} className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-neutral-900 hover:underline">{it.title}</div>
                      {it.subtitle && <div className="truncate text-xs text-neutral-500">{it.subtitle}</div>}
                    </Link>
                    <Link href={it.href} className="shrink-0 rounded-lg bg-neutral-900 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-neutral-700">{it.cta}</Link>
                  </li>
                ))}
              </ul>
              {g.items.length > 5 && <div className="mt-1 text-[11px] text-neutral-400">+{g.items.length - 5} more</div>}
            </div>
          ))}
        </div>
      )}

      {waitGroups.length > 0 && (
        <details className="rounded-xl border border-neutral-200 bg-neutral-50/60 px-4 py-2">
          <summary className="cursor-pointer text-[12px] font-semibold text-neutral-500">
            Waiting — no action needed yet ({waitGroups.reduce((n, g) => n + g.items.length, 0)})
          </summary>
          <div className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
            {waitGroups.map((g) => (
              <div key={g.key} className="py-1">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">{g.title} ({g.items.length})</div>
                <ul>
                  {g.items.slice(0, 5).map((it) => (
                    <li key={it.id} className="truncate py-0.5 text-[13px]">
                      <Link href={it.href} className="text-neutral-700 hover:underline">{it.title}</Link>
                      {it.subtitle && <span className="text-neutral-400"> · {it.subtitle}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
