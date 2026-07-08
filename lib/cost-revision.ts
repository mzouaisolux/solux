/**
 * Manufacturing Cost Revision — shared constants (m153 workflow).
 *
 * Pure and client-safe (no imports): used by the quotation locked-line card,
 * the Service-Request cost form and the request banner. Mirrors the
 * lib/shipping-update.ts UPDATE_REASONS + <datalist> pattern; the datalist
 * suggests, free text always stays possible — but unlike shipping, a cost
 * revision reason is MANDATORY (owner rule: every cost change is traceable).
 */

/** Reason suggestions (owner's list, 2026-07-08). Free text stays possible. */
export const COST_REVISION_REASONS = [
  "Supplier quotation updated",
  "Battery supplier increase",
  "Steel price increase",
  "Exchange rate adjustment",
  "Factory correction",
  "Engineering update",
  "Manual adjustment",
] as const;
