import AccessDenied from "@/components/AccessDenied";
import { getEffectiveRole } from "@/lib/auth";
import { canAccessOrAdmin } from "@/lib/permissions";
import { isAdminLike } from "@/lib/types";
import { getCostEntryData, getCostVersions } from "../admin/pricing/actions";
import CostGrid from "./CostGrid";

export const dynamic = "force-dynamic";

/**
 * Finance cost-entry — RMB costs only, organized by category. No margins or
 * tier prices here (those live in Pricing). Lives outside /admin so finance
 * can reach it. Saving creates a dated, audited cost version.
 */
export default async function CostEntryPage({ searchParams }: { searchParams?: { cat?: string } }) {
  const { effectiveRole } = await getEffectiveRole();
  const allowed = await canAccessOrAdmin(["pricing.manage_costs"], { finance: true });
  if (!allowed) return <AccessDenied capability="pricing.manage_costs" />;

  const [{ categories, products }, versions] = await Promise.all([getCostEntryData(), getCostVersions()]);
  const initialCategoryId =
    searchParams?.cat && categories.some((c) => c.id === searchParams.cat)
      ? searchParams.cat
      : categories.length > 0
        ? categories[0].id
        : "__all__";

  return (
    <div className="solux-pro sx-page">
      <div className="sx-wrap">
        <CostGrid
          products={products}
          categories={categories}
          initialCategoryId={initialCategoryId}
          versions={versions}
          canLinkPricing={isAdminLike(effectiveRole)}
        />
      </div>
    </div>
  );
}
