/**
 * Shared pricing settings loader (exchange rate + tax rebate).
 *
 * Reads the single `pricing_settings` row — the SAME source the Pricing module
 * uses (app/(app)/admin/pricing/actions.ts loadSettings). Extracted here so the
 * Project Requests pricing can reuse the exact engine inputs without depending
 * on the pricing module's server actions. Soft-fails to DEFAULT_SETTINGS.
 */

import type { createClient } from "@/lib/supabase/server";
import { DEFAULT_SETTINGS, type PricingSettings } from "@/lib/pricing-engine";
import {
  COSTING_DEFAULTS,
  type CostingValiditySettings,
} from "@/lib/costing-validity";

export async function loadPricingSettings(
  supabase: ReturnType<typeof createClient>
): Promise<PricingSettings> {
  try {
    const { data } = await supabase
      .from("pricing_settings")
      .select("exchange_rate, tax_rebate")
      .limit(1)
      .single();
    if (!data) return DEFAULT_SETTINGS;
    return { exchangeRate: Number(data.exchange_rate), taxRebate: Number(data.tax_rebate) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/**
 * Costing-validity thresholds (m140). DELIBERATELY a separate query from
 * loadPricingSettings: folding the m140 columns into that select would make a
 * not-yet-migrated env 42703 the whole row and silently fall back to the
 * DEFAULT exchange rate — mispricing every quotation. Here a missing column
 * only means "no validity policy yet" (feature dormant, defaults apply).
 */
export async function loadCostingSettings(
  supabase: ReturnType<typeof createClient>
): Promise<CostingValiditySettings> {
  try {
    const { data } = await supabase
      .from("pricing_settings")
      .select(
        "costing_aging_after_days, costing_expired_after_days, costing_require_revision_when_expired"
      )
      .limit(1)
      .single();
    if (!data) return COSTING_DEFAULTS;
    return {
      agingAfterDays: Number(
        (data as any).costing_aging_after_days ?? COSTING_DEFAULTS.agingAfterDays
      ),
      expiredAfterDays: Number(
        (data as any).costing_expired_after_days ??
          COSTING_DEFAULTS.expiredAfterDays
      ),
      requireRevisionWhenExpired: !!(data as any)
        .costing_require_revision_when_expired,
    };
  } catch {
    return COSTING_DEFAULTS;
  }
}
