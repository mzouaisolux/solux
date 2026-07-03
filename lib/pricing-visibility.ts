/**
 * TEMPORARY test-phase visibility flag (m142) — hide catalogue prices
 * from sales in the quotation builder.
 *
 * While the flag is ON, a line's price can only come from an approved
 * Service-Request costing or manual entry; the catalogue tier prices are
 * not rendered (and not sent to the client) for non-exempt users.
 *
 * PURE VISIBILITY: nothing here touches pricing data, pricing_source
 * (the m139 lock), saving, or the PDF. Flip the app_settings flag off to
 * restore today's behaviour — no deploy needed.
 *
 * Exemption follows the m122 governance pattern: admin/super_admin pass
 * via the anti-lockout floor, and the `pricing.view_catalogue_prices`
 * capability lets a super-admin delegate visibility to another role from
 * /permissions without touching code. Uses the EFFECTIVE role so a
 * View-As preview faithfully shows what a sales user sees (this is a UI
 * flag, not a security gate — sales can't read costs regardless, RLS).
 */

import type { createClient } from "@/lib/supabase/server";
import { getNumberSetting } from "@/lib/app-settings";
import { getEffectiveRole } from "@/lib/auth";
import { hasCapability } from "@/lib/permissions";
import { isAdminLike } from "@/lib/types";

export const HIDE_CATALOGUE_PRICES_KEY = "pricing.hide_catalogue_prices";

export type CataloguePriceVisibility = {
  /** Hide catalogue prices for THIS user (flag on + not exempt). */
  hidden: boolean;
  /**
   * Flag is on but this user is exempt — they see catalogue prices that
   * sales users don't. Drives the "visible admin only" badge so nobody
   * quotes a price on the phone that the sales rep can't see.
   */
  adminOverride: boolean;
};

const VISIBLE: CataloguePriceVisibility = { hidden: false, adminOverride: false };

export async function getCataloguePriceVisibility(
  supabase: ReturnType<typeof createClient>
): Promise<CataloguePriceVisibility> {
  // Flag absent / 0 / unreadable → prices visible (today's behaviour).
  const flag = await getNumberSetting(supabase, HIDE_CATALOGUE_PRICES_KEY, 0);
  if (flag !== 1) return VISIBLE;

  const { effectiveRole } = await getEffectiveRole();
  if (!effectiveRole) return { hidden: true, adminOverride: false };
  if (
    isAdminLike(effectiveRole) ||
    (await hasCapability("pricing.view_catalogue_prices", effectiveRole))
  ) {
    return { hidden: false, adminOverride: true };
  }
  return { hidden: true, adminOverride: false };
}
