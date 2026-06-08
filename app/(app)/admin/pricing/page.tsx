import Link from "next/link";
import { getPricingPageData, updateSettings } from "./actions";
import CreatePriceListForm from "./CreatePriceListForm";
import { isAdminLike, type PriceListStatus } from "@/lib/types";
import { getEffectiveRole } from "@/lib/auth";
import AccessDenied from "@/components/AccessDenied";

export const dynamic = "force-dynamic";

function StatusBadge({ status }: { status?: PriceListStatus }) {
  const s = status ?? "draft";
  const cls =
    s === "published"
      ? "bg-emerald-100 text-emerald-800"
      : s === "archived"
        ? "bg-neutral-200 text-neutral-500"
        : "bg-amber-100 text-amber-800";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${cls}`}>
      {s}
    </span>
  );
}

/**
 * Price Lists — CREATION ONLY.
 *
 * A price list is one product category + tier margins + a cost version, saved
 * as a draft. Creating one is <5% of the workflow, so this page does exactly
 * that and nothing else: pick a category, cost version and margins, preview,
 * and create. All management (view / filter / assign / publish / archive /
 * edit) lives in the Price List Library (/admin/pricing/library) and each
 * list's detail page. Creating here redirects straight to the new list's
 * detail workspace.
 */
export default async function CreatePriceListPage() {
  const { effectiveRole } = await getEffectiveRole();
  if (!isAdminLike(effectiveRole)) {
    return (
      <AccessDenied
        title="Administrators only"
        message="Pricing management is restricted to administrators."
      />
    );
  }

  const data = await getPricingPageData();
  const { settings, thinThreshold, categories, costVersions, products, lists } = data;
  const recent = lists.slice(0, 6);

  return (
    <div className="mx-auto max-w-screen-2xl px-6 py-8 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="eyebrow">Admin · Pricing</div>
          <h1 className="doc-title mt-1">Create a price list</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Costs come from{" "}
            <Link href="/cost-entry" className="row-link">
              Cost Entry
            </Link>{" "}
            (finance). Pick a category, cost version and tier margins, preview, and create a
            draft — then configure, assign and publish it from its page.
          </p>
        </div>
        <Link href="/admin/pricing/library" className="btn-secondary text-sm">
          Price List Library →
        </Link>
      </div>

      <CreatePriceListForm
        categories={categories}
        costVersions={costVersions}
        settings={settings}
        thinThreshold={thinThreshold}
        products={products}
      />

      {/* RECENT PRICE LISTS — connect creation to the management workspace. The
          Library is the primary tool; this is a quick peek + a door into it. */}
      <section className="rounded-lg border border-neutral-200 bg-white p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="eyebrow">Recent price lists</div>
          <Link href="/admin/pricing/library" className="row-link text-sm font-medium">
            View full library →
          </Link>
        </div>
        {recent.length === 0 ? (
          <p className="text-sm text-neutral-500">
            No price lists yet — create your first one above.
          </p>
        ) : (
          <ul className="-mx-2 space-y-0.5">
            {recent.map((l) => {
              const status = l.status ?? "draft";
              const dot =
                status === "published"
                  ? "bg-emerald-500"
                  : status === "archived"
                    ? "bg-neutral-300"
                    : "bg-amber-400";
              const assignment =
                l.assignments.length === 0
                  ? null
                  : l.assignments
                      .map((a) => a.assignee_name ?? a.assignee_id ?? a.assignee_type)
                      .join(", ");
              return (
                <li key={l.id}>
                  <Link
                    href={`/admin/pricing/${l.id}`}
                    className="group flex items-center gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-neutral-50"
                  >
                    <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden />
                    <span className="min-w-0 flex-1 truncate font-medium text-neutral-800">
                      {l.name}
                    </span>
                    <span className="hidden shrink-0 text-xs text-neutral-400 sm:inline">
                      {l.categoryName ?? "All"}
                    </span>
                    <StatusBadge status={l.status} />
                    <span
                      className={`hidden w-44 shrink-0 truncate text-right text-xs md:inline ${
                        assignment ? "text-neutral-500" : "text-neutral-300 italic"
                      }`}
                    >
                      {assignment ?? "Unassigned"}
                    </span>
                    <span className="shrink-0 text-neutral-300 transition-colors group-hover:text-neutral-600">
                      →
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Global pricing parameters — used by every price list's computation. */}
      <details className="rounded-lg border border-neutral-200 bg-white p-4">
        <summary className="cursor-pointer text-sm text-neutral-600 hover:text-neutral-900">
          Global settings (exchange rate, tax rebate, thin-margin threshold)
        </summary>
        <form action={updateSettings} className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <label className="block">
            <span className="text-xs font-medium text-neutral-600">Exchange rate (RMB→USD)</span>
            <input name="exchangeRate" type="number" step="0.0001" min="0" defaultValue={settings.exchangeRate} className="mt-1 w-full rounded border px-3 py-2 tabular-nums" />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-neutral-600">Tax rebate</span>
            <input name="taxRebate" type="number" step="0.01" min="0" max="1" defaultValue={settings.taxRebate} className="mt-1 w-full rounded border px-3 py-2 tabular-nums" />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-neutral-600">Thin-margin threshold</span>
            <input name="thinMarginThreshold" type="number" step="0.01" min="0" max="1" defaultValue={thinThreshold} className="mt-1 w-full rounded border px-3 py-2 tabular-nums" />
          </label>
          <div className="sm:col-span-3 flex justify-end">
            <button className="btn-secondary">Save settings</button>
          </div>
        </form>
      </details>
    </div>
  );
}
