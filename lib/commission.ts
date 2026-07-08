// Single source of truth for commission math.
// Commission is applied on top of (items + freight) and increases the
// customer-facing grand total. It also reduces the seller's margin.

export type CommissionInput = {
  enabled: boolean;
  percentage: number; // 0–100
};

// For the full document grand total (items + freight + commission + m146
// shipping extras) use lib/document-total.ts documentGrandTotal.
export function commissionAmount(
  itemsAndFreight: number,
  input: CommissionInput
): number {
  if (!input.enabled) return 0;
  const pct = Number(input.percentage || 0);
  if (pct <= 0) return 0;
  return Math.max(0, Number(itemsAndFreight || 0) * (pct / 100));
}
