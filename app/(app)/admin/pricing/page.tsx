import Link from "next/link";
import { getPricingPageData, updateSettings } from "./actions";
import CreatePriceListForm from "./CreatePriceListForm";
import { isAdminLike, type PriceListStatus } from "@/lib/types";
import { getEffectiveRole } from "@/lib/auth";
import AccessDenied from "@/components/AccessDenied";
import { canAccessOrAdmin } from "@/lib/permissions";

export const dynamic = "force-dynamic";

function StatusBadge({ status }: { status?: PriceListStatus }) {
  const s = status ?? "draft";
  return <span className={`px-sbadge ${s}`}>{s}</span>;
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
  if (!(await canAccessOrAdmin(["pricing.manage"]))) {
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
    <div className="solux-pro mx-auto max-w-screen-2xl px-6 py-8 space-y-6">
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
        <Link href="/admin/pricing/library" className="sx-btn sx-btn-ink">
          Price List Library →
        </Link>
      </div>

      {/* WORKFLOW BANNER */}
      <div className="px-banner">
        <div>
          <div className="px-micro" style={{ color: "var(--sx-ink)" }}>Create → Library → Assign</div>
          <p>
            <b>Create</b> a draft (category + margins). It lands in the <b>Library</b> where you view, filter and maintain it. Configure the product prices, then <b>Publish</b> to push live prices into the quote builder, and <b>Assign</b> the list to the sellers / teams who quote on it. Creating is &lt;5% of the workflow — the other 95% lives in the Library and each list&apos;s detail page.
          </p>
        </div>
      </div>

      <CreatePriceListForm
        categories={categories}
        costVersions={costVersions}
        settings={settings}
        thinThreshold={thinThreshold}
        products={products}
      />

      {/* RECENT PRICE LISTS */}
      <section className="card sec">
        <div className="sechead" style={{ marginBottom: 0 }}>
          <div>
            <div className="px-micro">Recent price lists</div>
            <div style={{ fontSize: 13, color: "var(--sx-mute)", margin: "6px 0 0" }}>
              Compact peek — a door into the full Library.
            </div>
          </div>
          <Link href="/admin/pricing/library" className="sx-link">View full library →</Link>
        </div>
        {recent.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--sx-mute)", marginTop: 12 }}>
            No price lists yet — create your first one above.
          </p>
        ) : (
          <div style={{ marginTop: 10 }}>
            {recent.map((l) => {
              const status = l.status ?? "draft";
              const assignment =
                l.assignments.length === 0
                  ? null
                  : l.assignments.map((a) => a.assignee_name ?? a.assignee_id ?? a.assignee_type).join(", ");
              return (
                <Link key={l.id} href={`/admin/pricing/${l.id}`} className="px-recent-row">
                  <span className={`px-dot ${status}`} aria-hidden />
                  <span className="nm">{l.name}</span>
                  <span className="px-sub" style={{ width: 130, textAlign: "right", flex: "none" }}>{l.categoryName ?? "All"}</span>
                  <StatusBadge status={l.status} />
                  <span className="rc" style={assignment ? undefined : { fontStyle: "italic" }}>{assignment ?? "Unassigned"}</span>
                  <span style={{ color: "var(--sx-mute-2)" }}>→</span>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* Global pricing parameters */}
      <details className="card sec px-collap">
        <summary>Global settings — exchange rate, tax rebate, thin-margin threshold</summary>
        <div style={{ fontSize: 13, color: "var(--sx-mute)", margin: "12px 0 0", lineHeight: 1.6 }}>
          Used by every price list&apos;s computation. Selling price = usdCost × (1 − rebate) ÷ (1 − margin).
        </div>
        <form action={updateSettings}>
          <div className="px-settings-grid">
            <div className="fcol"><span className="px-flabel">Exchange rate (RMB→USD)</span><input name="exchangeRate" type="number" step="0.0001" min="0" defaultValue={settings.exchangeRate} style={{ textAlign: "right" }} /></div>
            <div className="fcol"><span className="px-flabel">Tax rebate</span><input name="taxRebate" type="number" step="0.01" min="0" max="1" defaultValue={settings.taxRebate} style={{ textAlign: "right" }} /></div>
            <div className="fcol"><span className="px-flabel">Thin-margin threshold</span><input name="thinMarginThreshold" type="number" step="0.01" min="0" max="1" defaultValue={thinThreshold} style={{ textAlign: "right" }} /></div>
          </div>
          <div className="savebar"><button className="sx-btn">Save settings</button></div>
        </form>
      </details>
    </div>
  );
}
