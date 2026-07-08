import { commissionAmount, type CommissionInput } from "./commission.ts";
import {
  normalizeAdditionalCharges,
  shippingExtrasTotal,
} from "./logistics.ts";

/**
 * Grand total of a commercial document, rebuilt from its parts:
 *
 *   subtotal        = items + freight (freight already carries the LCL
 *                     wooden box — totalFreight / containerLineTotal)
 *   commission      = % of subtotal ONLY — extras are pass-through
 *                     disbursements, excluded from the base (m146)
 *   shipping extras = insurance + additional charges (ECTN, BESC, FERI…)
 *   grand total     = subtotal + commission + shipping extras
 *
 * MUST mirror the builder math in saveDocument (app/(app)/documents/new/
 * actions.ts:176-192): a server-side recompute (m149 shipping-update
 * completion) has to land on the exact figure a Sales re-save would
 * produce, otherwise the stored documents.total_price and the on-page
 * breakdown disagree again.
 */
export type DocumentTotalParts = {
  itemsTotal: number;
  freightTotal: number;
  commission: CommissionInput;
  insuranceCost?: number | string | null;
  additionalCharges?: ReadonlyArray<{
    label?: unknown;
    amount?: unknown;
  }> | null;
};

export function documentGrandTotal(parts: DocumentTotalParts): {
  subtotal: number;
  commission_amount: number;
  shipping_extras: number;
  grand_total: number;
} {
  const subtotal =
    (Number(parts.itemsTotal) || 0) + (Number(parts.freightTotal) || 0);
  const commission_amount = commissionAmount(subtotal, parts.commission);
  const shipping_extras = shippingExtrasTotal(
    Number(parts.insuranceCost) || 0,
    normalizeAdditionalCharges(parts.additionalCharges)
  );
  return {
    subtotal,
    commission_amount,
    shipping_extras,
    grand_total: subtotal + commission_amount + shipping_extras,
  };
}
