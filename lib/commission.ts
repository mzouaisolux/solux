// Single source of truth for commission math.
// Commission is applied on top of (items + freight) and increases the
// customer-facing grand total. It also reduces the seller's margin.

export type CommissionInput = {
  enabled: boolean;
  percentage: number; // 0–100
};

export function commissionAmount(
  itemsAndFreight: number,
  input: CommissionInput
): number {
  if (!input.enabled) return 0;
  const pct = Number(input.percentage || 0);
  if (pct <= 0) return 0;
  return Math.max(0, Number(itemsAndFreight || 0) * (pct / 100));
}

export function computeTotals({
  itemsTotal,
  freightTotal,
  commission,
}: {
  itemsTotal: number;
  freightTotal: number;
  commission: CommissionInput;
}) {
  const subtotal = Number(itemsTotal || 0) + Number(freightTotal || 0);
  const commission_amount = commissionAmount(subtotal, commission);
  return {
    subtotal,
    commission_amount,
    grand_total: subtotal + commission_amount,
  };
}
