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
