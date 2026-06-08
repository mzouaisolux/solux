import Link from "next/link";
import {
  getPriceListDetail,
  updatePriceList,
  deletePriceList,
  duplicatePriceList,
  archivePriceList,
  unpublishPriceList,
  removeAssignment,
} from "../actions";
import PricingActionsClient from "../PricingActionsClient";
import AssignmentForm from "../AssignmentForm";
import { listAssignableOwners } from "@/lib/owner";
import { fmtPct } from "@/lib/pricing-engine";
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
 * Price List Detail — the dedicated workspace for one price list (a strategic
 * commercial asset). Header + product pricing table + actions + assignment
 * management. This is where the 95% management work happens; creation lives on
 * /admin/pricing and the library on /admin/pricing/library.
 */
export default async function PriceListDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const { effectiveRole } = await getEffectiveRole();
  if (!isAdminLike(effectiveRole)) {
    return (
      <AccessDenied
        title="Administrators only"
        message="Pricing management is restricted to administrators."
      />
    );
  }

  const [detail, owners] = await Promise.all([
    getPriceListDetail(params.id),
    listAssignableOwners(),
  ]);

  if (!detail?.list) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-12 text-center">
        <h1 className="text-base font-semibold text-neutral-900">Price list not found.</h1>
        <p className="mt-2 text-sm text-neutral-500">
          It may have been deleted.{" "}
          <Link href="/admin/pricing/library" className="row-link">
            Back to the Price List Library →
          </Link>
        </p>
      </div>
    );
  }

  const { list, rows } = detail;
  const ownerName = new Map(owners.map((o) => [o.id, o.name]));
  const money = (n: number) => n.toFixed(2);
  const costedCount = rows.filter((r) => r.costRmb > 0).length;
  const missingCount = rows.filter((r) => r.costRmb <= 0).length;
  const nameOf = (id: string | null | undefined) => (id ? ownerName.get(id) ?? "—" : "—");

  return (
    <div className="mx-auto max-w-screen-2xl px-6 py-8 space-y-6">
      <Link
        href="/admin/pricing/library"
        className="text-sm text-neutral-500 hover:text-neutral-900"
      >
        ← Price List Library
      </Link>

      {/* HEADER */}
      <div className="rounded-lg border border-neutral-200 bg-white p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="doc-title">{list.name}</h1>
          <StatusBadge status={list.status} />
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-3 lg:grid-cols-4">
          <Meta label="Category" value={list.categoryName ?? "All"} />
          <Meta
            label="Margins T1/T2/T3"
            value={`${fmtPct(list.target_margin1, 0)} / ${fmtPct(list.target_margin2, 0)} / ${fmtPct(list.target_margin3, 0)}`}
          />
          <Meta label="Cost version" value={list.costVersionLabel ?? "Latest active"} />
          <Meta label="Effective date" value={list.effective_date ?? "—"} />
          <Meta
            label="Created"
            value={`${list.created_at ? list.created_at.slice(0, 10) : "—"} · ${nameOf(list.created_by)}`}
          />
          <Meta
            label="Last updated"
            value={`${list.updated_at ? list.updated_at.slice(0, 10) : "—"} · ${nameOf(list.updated_by)}`}
          />
          <Meta label="Products" value={String(list.productCount)} />
          <Meta
            label="Assigned to"
            value={
              list.assignments.length === 0
                ? "—"
                : list.assignments
                    .map((a) => a.assignee_name ?? a.assignee_id ?? a.assignee_type)
                    .join(", ")
            }
          />
        </div>
        {list.notes && <p className="text-sm italic text-neutral-500">{list.notes}</p>}
      </div>

      {/* ACTIONS */}
      <div className="rounded-lg border border-neutral-200 bg-white p-4 space-y-2">
        <div className="eyebrow">Actions</div>
        <p className="text-xs text-neutral-500">
          Publishing makes these prices active in the quote builder for sellers assigned to
          this list ({costedCount} product{costedCount === 1 ? "" : "s"} with a cost
          {missingCount > 0 ? `; ${missingCount} skipped — no cost` : ""}).
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <PricingActionsClient priceListId={list.id} listName={list.name} totalCount={costedCount} missingCount={missingCount} />
          {list.status === "published" && (
            <form action={unpublishPriceList}>
              <input type="hidden" name="id" value={list.id} />
              <button className="text-sm text-neutral-600 hover:underline">Unpublish</button>
            </form>
          )}
          <form action={duplicatePriceList}>
            <input type="hidden" name="id" value={list.id} />
            <button className="text-sm text-neutral-600 hover:underline">Duplicate</button>
          </form>
          {list.status !== "archived" && (
            <form action={archivePriceList}>
              <input type="hidden" name="id" value={list.id} />
              <button className="text-sm text-neutral-600 hover:underline">Archive</button>
            </form>
          )}
          <form action={deletePriceList}>
            <input type="hidden" name="id" value={list.id} />
            <button className="text-sm text-rose-600 hover:underline">Delete</button>
          </form>
        </div>
      </div>

      {/* INCOMPLETE-LINE WARNING */}
      {missingCount > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span className="font-semibold">
            {missingCount} of {rows.length} product{rows.length === 1 ? "" : "s"} in this category{" "}
            {missingCount === 1 ? "has" : "have"} no active cost.
          </span>{" "}
          {missingCount === 1 ? "It is" : "They are"} shown below as{" "}
          <span className="font-medium">Missing cost</span> and will be skipped when you publish —
          the other {costedCount} calculate normally. Enter a cost in Cost entry, then re-open and
          re-publish this list to include {missingCount === 1 ? "it" : "them"}.
        </div>
      )}

      {/* PRODUCT PRICING TABLE */}
      <section className="panel overflow-x-auto">
        <div className="px-4 py-2.5 bg-solux-muted border-b border-neutral-200 eyebrow flex items-center justify-between gap-2">
          <span>Product pricing</span>
          <span className="text-[10px] font-normal normal-case text-neutral-400">
            Live preview at current costs · {costedCount} priced
            {missingCount > 0 ? ` · ${missingCount} missing cost` : ""}
          </span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-solux-accent text-left">
              <th className="px-3 py-2 text-xs font-semibold text-neutral-700">Product</th>
              <th className="px-3 py-2 text-xs font-semibold text-neutral-700 text-right">Cost (USD)</th>
              <th className="px-3 py-2 text-xs font-semibold text-neutral-700 text-right">Tier 1</th>
              <th className="px-3 py-2 text-xs font-semibold text-neutral-700 text-right">Tier 2</th>
              <th className="px-3 py-2 text-xs font-semibold text-neutral-700 text-right">Tier 3</th>
              <th className="px-3 py-2 text-xs font-semibold text-neutral-700">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-neutral-500">
                  No products in this category.
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const anyThin = r.tiers.some((t) => t.thin);
                const noCost = r.costRmb <= 0;
                return (
                  <tr key={r.id} className="border-t border-neutral-100">
                    <td className="px-3 py-2">
                      <span className="font-medium">{r.name}</span>
                      <span className="ml-2 font-mono text-[11px] text-neutral-400">{r.sku ?? "—"}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {noCost ? "—" : money(r.usdCost)}
                    </td>
                    {r.tiers.map((t, i) => (
                      <td
                        key={i}
                        className={`px-3 py-2 text-right tabular-nums ${t.thin ? "bg-rose-50/60" : ""}`}
                      >
                        {noCost ? (
                          "—"
                        ) : (
                          <>
                            <span className="font-medium">{money(t.price)}</span>
                            <span className="block text-[10px] text-neutral-500">
                              {fmtPct(t.marginPctAfterTax)}
                            </span>
                          </>
                        )}
                      </td>
                    ))}
                    <td className="px-3 py-2">
                      {noCost ? (
                        <span
                          className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700"
                          title="No active cost for this product — it will be skipped when publishing."
                        >
                          Missing cost
                        </span>
                      ) : anyThin ? (
                        <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-700">
                          Thin margin
                        </span>
                      ) : (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                          OK
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </section>

      {/* EDIT DETAILS (collapsible) */}
      <details className="rounded-lg border border-neutral-200 bg-white p-4">
        <summary className="cursor-pointer text-sm text-neutral-600 hover:text-neutral-900">
          Edit list details &amp; margins
        </summary>
        <form action={updatePriceList} className="mt-3 flex flex-wrap items-end gap-3">
          <input type="hidden" name="id" value={list.id} />
          <label className="block">
            <span className="text-[11px] text-neutral-500">Name</span>
            <input name="name" defaultValue={list.name} required className="mt-0.5 block rounded border px-2 py-1 text-sm" />
          </label>
          <label className="block">
            <span className="text-[11px] text-neutral-500">T1</span>
            <input name="targetMargin1" type="number" step="0.01" min="0" max="0.99" defaultValue={list.target_margin1} className="mt-0.5 block w-20 rounded border px-2 py-1 text-sm tabular-nums" />
          </label>
          <label className="block">
            <span className="text-[11px] text-neutral-500">T2</span>
            <input name="targetMargin2" type="number" step="0.01" min="0" max="0.99" defaultValue={list.target_margin2} className="mt-0.5 block w-20 rounded border px-2 py-1 text-sm tabular-nums" />
          </label>
          <label className="block">
            <span className="text-[11px] text-neutral-500">T3</span>
            <input name="targetMargin3" type="number" step="0.01" min="0" max="0.99" defaultValue={list.target_margin3} className="mt-0.5 block w-20 rounded border px-2 py-1 text-sm tabular-nums" />
          </label>
          <label className="block">
            <span className="text-[11px] text-neutral-500">Effective date</span>
            <input name="effectiveDate" type="date" defaultValue={list.effective_date ?? ""} className="mt-0.5 block rounded border px-2 py-1 text-sm" />
          </label>
          <label className="block flex-1 min-w-[12rem]">
            <span className="text-[11px] text-neutral-500">Notes</span>
            <input name="notes" defaultValue={list.notes ?? ""} className="mt-0.5 block w-full rounded border px-2 py-1 text-sm" />
          </label>
          <button className="btn-secondary text-sm">Save</button>
        </form>
        <p className="mt-1 text-[11px] text-neutral-400">
          After editing a published list, re-publish to push the new prices to quotes.
        </p>
      </details>

      {/* ASSIGNMENTS */}
      <section className="rounded-lg border border-neutral-200 bg-white p-4 space-y-3">
        <div className="eyebrow">Assigned to — who quotes on this list</div>
        {list.assignments.length === 0 ? (
          <p className="text-sm text-neutral-500">Not assigned yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {list.assignments.map((a) => (
              <span
                key={a.id}
                className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2.5 py-1 text-sm"
              >
                <span className="text-neutral-500">{a.assignee_type}:</span>
                {a.assignee_name ?? a.assignee_id ?? "—"}
                <form action={removeAssignment} className="inline">
                  <input type="hidden" name="id" value={a.id} />
                  <button className="ml-1 text-neutral-400 hover:text-rose-600" title="Unassign">
                    ×
                  </button>
                </form>
              </span>
            ))}
          </div>
        )}
        <div className="border-t border-neutral-100 pt-3">
          <AssignmentForm
            priceListId={list.id}
            sellers={owners.map((s) => ({ id: s.id, name: s.name }))}
          />
        </div>
      </section>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-widerx text-neutral-400">{label}</div>
      <div className="truncate text-neutral-800">{value}</div>
    </div>
  );
}
