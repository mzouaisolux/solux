import { redirect } from "next/navigation";
import Link from "next/link";
import { getEffectiveRole } from "@/lib/auth";
import { isAdminLike } from "@/lib/types";
import { getCostEntryData } from "../admin/pricing/actions";
import CostGrid from "./CostGrid";

export const dynamic = "force-dynamic";

/**
 * Finance cost-entry — RMB costs only, organized by category. No margins or
 * tier prices here (those live in Pricing). Lives outside /admin so finance
 * can reach it. Saving creates a dated, audited cost version.
 */
export default async function CostEntryPage({ searchParams }: { searchParams?: { cat?: string } }) {
  const { effectiveRole } = await getEffectiveRole();
  const allowed = isAdminLike(effectiveRole) || effectiveRole === "finance";
  if (!allowed) redirect("/dashboard");

  const { categories, products, latestBatch } = await getCostEntryData();
  const initialCategoryId =
    searchParams?.cat && categories.some((c) => c.id === searchParams.cat)
      ? searchParams.cat
      : categories.length > 0
        ? categories[0].id
        : "__all__";

  return (
    <div className="mx-auto max-w-screen-xl px-6 py-8 space-y-5">
      <div>
        <div className="eyebrow">Finance</div>
        <h1 className="doc-title mt-1">Cost entry (RMB)</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Enter product costs in RMB, one category at a time. Tab/Enter moves down; paste a column from Excel.
          Saving creates a dated cost version. Margins &amp; selling prices are set under{" "}
          {isAdminLike(effectiveRole) ? (
            <Link href="/admin/pricing" className="row-link">
              Pricing
            </Link>
          ) : (
            "Pricing"
          )}
          .
          {latestBatch && (
            <>
              {" "}Latest version: <span className="font-medium">{latestBatch.effective_date}</span>
              {latestBatch.note ? ` — ${latestBatch.note}` : ""}.
            </>
          )}
        </p>
      </div>

      <CostGrid products={products} categories={categories} initialCategoryId={initialCategoryId} />
    </div>
  );
}
