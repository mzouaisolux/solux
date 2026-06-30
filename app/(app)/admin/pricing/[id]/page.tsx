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
  return <span className={`px-sbadge ${s}`}>{s}</span>;
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
    <div className="solux-pro mx-auto max-w-screen-2xl px-6 py-8 space-y-6">
      <Link className="sx-backlink" href="/admin/pricing/library">
        ← Price List Library
      </Link>

      {/* HEADER */}
      <div className="card sec">
        <div className="flex flex-wrap items-center gap-3">
          <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.01em", margin: 0 }}>{list.name}</h1>
          <StatusBadge status={list.status} />
        </div>
        <div className="px-meta-grid">
          <Meta label="Category" value={list.categoryName ?? "All"} />
          <Meta
            label="Margins T1/T2/T3"
            value={`${fmtPct(list.target_margin1, 0)} / ${fmtPct(list.target_margin2, 0)} / ${fmtPct(list.target_margin3, 0)}`}
          />
          <Meta label="Cost version" value={list.costVersionLabel ?? "Latest active"} />
          <Meta label="Effective date" value={list.effective_date ?? "—"} />
          <Meta label="Created" value={`${list.created_at ? list.created_at.slice(0, 10) : "—"} · ${nameOf(list.created_by)}`} />
          <Meta label="Last updated" value={`${list.updated_at ? list.updated_at.slice(0, 10) : "—"} · ${nameOf(list.updated_by)}`} />
          <Meta label="Products" value={String(list.productCount)} />
          <Meta
            label="Assigned to"
            value={
              list.assignments.length === 0
                ? "—"
                : list.assignments.map((a) => a.assignee_name ?? a.assignee_id ?? a.assignee_type).join(", ")
            }
          />
        </div>
        {list.notes && <p style={{ fontStyle: "italic", marginTop: 14, fontSize: 13, color: "var(--sx-mute)" }}>{list.notes}</p>}
      </div>

      {/* ACTIONS */}
      <div className="card sec">
        <div className="px-micro">Actions</div>
        <p style={{ fontSize: 13, color: "var(--sx-mute)", lineHeight: 1.6, margin: "8px 0 16px", maxWidth: 880 }}>
          Publishing makes these prices active in the quote builder for sellers assigned to this list ({costedCount} product{costedCount === 1 ? "" : "s"} with a cost{missingCount > 0 ? `; ${missingCount} skipped — no cost` : ""}).
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16 }}>
          <PricingActionsClient priceListId={list.id} listName={list.name} totalCount={costedCount} missingCount={missingCount} />
          {list.status === "published" && (
            <form action={unpublishPriceList}>
              <input type="hidden" name="id" value={list.id} />
              <button className="sx-muted-link">Unpublish</button>
            </form>
          )}
          <form action={duplicatePriceList}>
            <input type="hidden" name="id" value={list.id} />
            <button className="sx-muted-link">Duplicate</button>
          </form>
          {list.status !== "archived" && (
            <form action={archivePriceList}>
              <input type="hidden" name="id" value={list.id} />
              <button className="sx-muted-link">Archive</button>
            </form>
          )}
          <form action={deletePriceList}>
            <input type="hidden" name="id" value={list.id} />
            <button className="px-link-amber">Delete</button>
          </form>
        </div>
      </div>

      {/* MISSING-COST NOTICE */}
      {missingCount > 0 && (
        <div className="px-notice amber">
          <b>{missingCount} of {rows.length} product{rows.length === 1 ? "" : "s"} in this category {missingCount === 1 ? "has" : "have"} no active cost.</b>{" "}
          {missingCount === 1 ? "It is" : "They are"} shown below as <b>Missing cost</b> and will be skipped when you publish — the other {costedCount} calculate normally. Enter a cost in Cost entry, then re-open and re-publish this list to include {missingCount === 1 ? "it" : "them"}.
        </div>
      )}

      {/* PRODUCT PRICING TABLE */}
      <div className="card" style={{ padding: 0, marginTop: 18 }}>
        <div className="px-tblhead">
          <span className="px-micro" style={{ color: "var(--sx-ink)" }}>Product pricing</span>
          <span style={{ fontSize: 12, color: "var(--sx-mute)" }}>
            Live preview at current costs · {costedCount} priced{missingCount > 0 ? ` · ${missingCount} missing cost` : ""}
          </span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="px-grid">
            <thead>
              <tr>
                <th>Product</th>
                <th className="num">Cost (USD)</th>
                <th className="num">Tier 1</th>
                <th className="num">Tier 2</th>
                <th className="num">Tier 3</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", padding: "28px 12px", color: "var(--sx-mute)" }}>
                    No products in this category.
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const anyThin = r.tiers.some((t) => t.thin);
                  const noCost = r.costRmb <= 0;
                  return (
                    <tr key={r.id}>
                      <td>
                        <span className="px-pname">{r.name}</span>
                        <span className="px-sku">{r.sku ?? "—"}</span>
                      </td>
                      <td className="num">{noCost ? <span className="px-muteit">—</span> : money(r.usdCost)}</td>
                      {r.tiers.map((t, i) => (
                        <td key={i} className={`num ${t.thin ? "thincell" : ""}`}>
                          {noCost ? (
                            <span className="px-muteit">—</span>
                          ) : (
                            <span className="px-cellprice">
                              {money(t.price)}
                              <span className="mg">{fmtPct(t.marginPctAfterTax)}</span>
                            </span>
                          )}
                        </td>
                      ))}
                      <td>
                        {noCost ? (
                          <span className="px-sbadge missing" title="No active cost — skipped when publishing.">Missing cost</span>
                        ) : anyThin ? (
                          <span className="px-sbadge thin">Thin margin</span>
                        ) : (
                          <span className="px-sbadge ok">OK</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* EDIT DETAILS (collapsible) */}
      <details className="card sec px-collap">
        <summary>Edit list details &amp; margins</summary>
        <form action={updatePriceList} className="px-editrow">
          <input type="hidden" name="id" value={list.id} />
          <div className="fcol"><span className="px-flabel">Name</span><input className="wname" name="name" defaultValue={list.name} required type="text" /></div>
          <div className="fcol"><span className="px-flabel">T1</span><input className="w20" name="targetMargin1" type="number" step="0.01" min="0" max="0.99" defaultValue={list.target_margin1} /></div>
          <div className="fcol"><span className="px-flabel">T2</span><input className="w20" name="targetMargin2" type="number" step="0.01" min="0" max="0.99" defaultValue={list.target_margin2} /></div>
          <div className="fcol"><span className="px-flabel">T3</span><input className="w20" name="targetMargin3" type="number" step="0.01" min="0" max="0.99" defaultValue={list.target_margin3} /></div>
          <div className="fcol"><span className="px-flabel">Effective date</span><input name="effectiveDate" type="date" defaultValue={list.effective_date ?? ""} /></div>
          <div className="fcol grow"><span className="px-flabel">Notes</span><input name="notes" defaultValue={list.notes ?? ""} type="text" /></div>
          <button className="sx-btn">Save</button>
        </form>
        <div className="px-fhint">After editing a published list, re-publish to push the new prices to quotes.</div>
      </details>

      {/* ASSIGNMENTS */}
      <div className="card sec">
        <div className="px-micro">Assigned to — who quotes on this list</div>
        {list.assignments.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--sx-mute)", marginTop: 10 }}>Not assigned yet.</p>
        ) : (
          <div className="px-chips">
            {list.assignments.map((a) => (
              <span key={a.id} className="px-chip">
                <span className="k">{a.assignee_type}:</span>
                {a.assignee_name ?? a.assignee_id ?? "—"}
                <form action={removeAssignment} style={{ display: "inline" }}>
                  <input type="hidden" name="id" value={a.id} />
                  <button className="x" title="Unassign">×</button>
                </form>
              </span>
            ))}
          </div>
        )}
        <div style={{ borderTop: "1px solid var(--sx-line)", marginTop: 16, paddingTop: 16 }}>
          <AssignmentForm priceListId={list.id} sellers={owners.map((s) => ({ id: s.id, name: s.name }))} />
        </div>
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="meta min-w-0">
      <div className="mk">{label}</div>
      <div className="mv truncate">{value}</div>
    </div>
  );
}
