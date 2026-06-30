import Link from "next/link";
import { getPricingPageData } from "../actions";
import { listAssignableOwners } from "@/lib/owner";
import { fmtPct } from "@/lib/pricing-engine";
import { isAdminLike } from "@/lib/types";
import { getEffectiveRole } from "@/lib/auth";
import AccessDenied from "@/components/AccessDenied";
import { canAccessOrAdmin } from "@/lib/permissions";
import LibraryTable, { type LibraryRow } from "./LibraryTable";

export const dynamic = "force-dynamic";

/**
 * Price List Library — the central management workspace. Creating a price list
 * is <5% of the workflow; viewing / filtering / assigning / publishing /
 * maintaining them is the other 95%, and that all happens here. Data-first:
 * a filter bar + a selectable table with bulk actions. Open → detail page.
 */
export default async function PriceListLibraryPage({
  searchParams,
}: {
  searchParams?: {
    q?: string;
    fstatus?: string;
    fcat?: string;
    fcreated?: string;
    fassigned?: string;
    feff?: string;
  };
}) {
  const { effectiveRole } = await getEffectiveRole();
  if (!(await canAccessOrAdmin(["pricing.manage"]))) {
    return (
      <AccessDenied
        title="Administrators only"
        message="Pricing management is restricted to administrators."
      />
    );
  }

  const [data, owners] = await Promise.all([getPricingPageData(), listAssignableOwners()]);
  const { categories, lists } = data;
  const ownerName = new Map(owners.map((o) => [o.id, o.name]));
  const nameOf = (id: string | null | undefined) => (id ? ownerName.get(id) ?? "—" : "—");

  // Filters (server-side; the bar below is a plain GET form).
  const q = (searchParams?.q ?? "").trim().toLowerCase();
  const fstatus = searchParams?.fstatus ?? "";
  const fcat = searchParams?.fcat ?? "";
  const fcreated = searchParams?.fcreated ?? "";
  const fassigned = searchParams?.fassigned ?? "";
  const feff = searchParams?.feff ?? "";

  const filtered = lists.filter((l) => {
    if (q && !l.name.toLowerCase().includes(q)) return false;
    if (fstatus && (l.status ?? "draft") !== fstatus) return false;
    if (fcat && l.category_id !== fcat) return false;
    if (fcreated && l.created_by !== fcreated) return false;
    if (fassigned && !l.assignments.some((a) => a.assignee_id === fassigned)) return false;
    if (feff && !(l.effective_date && l.effective_date >= feff)) return false;
    return true;
  });

  // Distinct creators present in the data → filter dropdown.
  const creators = Array.from(
    new Map(
      lists
        .filter((l) => l.created_by)
        .map((l) => [l.created_by as string, nameOf(l.created_by)])
    ).entries()
  ).map(([id, name]) => ({ id, name }));

  const rows: LibraryRow[] = filtered.map((l) => ({
    id: l.id,
    name: l.name,
    categoryName: l.categoryName ?? null,
    status: (l.status ?? "draft") as LibraryRow["status"],
    margins: `${fmtPct(l.target_margin1, 0)}/${fmtPct(l.target_margin2, 0)}/${fmtPct(l.target_margin3, 0)}`,
    effectiveDate: l.effective_date ?? null,
    createdDate: l.created_at ? l.created_at.slice(0, 10) : null,
    createdBy: nameOf(l.created_by),
    assignedTo:
      l.assignments.length === 0
        ? "—"
        : l.assignments.map((a) => a.assignee_name ?? a.assignee_id ?? a.assignee_type).join(", "),
    productCount: l.productCount,
    lastUpdated: l.updated_at ? l.updated_at.slice(0, 10) : null,
  }));

  const field =
    "rounded border border-neutral-300 px-2 py-1 text-sm bg-white";

  return (
    <div className="solux-pro mx-auto max-w-screen-2xl px-6 py-8 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="eyebrow">Admin · Pricing</div>
          <h1 className="doc-title mt-1">Price List Library</h1>
          <p className="mt-1 text-sm text-neutral-500">
            View, filter, assign, publish and maintain every price list ({lists.length} total).
          </p>
        </div>
        <Link href="/admin/pricing" className="sx-btn">
          + Create price list
        </Link>
      </div>

      {/* FILTER BAR — plain GET form (data-first, no client state) */}
      <form className="card sec px-filterbar" action="/admin/pricing/library">
        <div className="fcol">
          <span className="px-flabel">Search</span>
          <input name="q" defaultValue={searchParams?.q ?? ""} placeholder="Name…" type="text" />
        </div>
        <div className="fcol">
          <span className="px-flabel">Status</span>
          <select name="fstatus" defaultValue={fstatus}>
            <option value="">All</option>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="archived">Archived</option>
          </select>
        </div>
        <div className="fcol">
          <span className="px-flabel">Category</span>
          <select name="fcat" defaultValue={fcat}>
            <option value="">All</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="fcol">
          <span className="px-flabel">Created by</span>
          <select name="fcreated" defaultValue={fcreated}>
            <option value="">Anyone</option>
            {creators.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="fcol">
          <span className="px-flabel">Assigned to</span>
          <select name="fassigned" defaultValue={fassigned}>
            <option value="">Anyone</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>
        <div className="fcol">
          <span className="px-flabel">Effective from</span>
          <input name="feff" type="date" defaultValue={feff} />
        </div>
        <button className="sx-btn">Apply</button>
        <Link href="/admin/pricing/library" className="px-reset">Reset</Link>
      </form>

      <LibraryTable rows={rows} sellers={owners.map((o) => ({ id: o.id, name: o.name }))} />
    </div>
  );
}
