/**
 * Vocabulary + palette for the advisory quotation-validation loop (m068).
 *
 * Pure module (no server imports) so both the server doc page and any
 * client component can share it. The workflow is deliberately light:
 *
 *   none → (sales clicks "Request validation") → pending
 *   pending → (manager) → approved   ("looks good")
 *   pending → (manager) → rejected   ("changes requested")
 *   rejected → (sales revises, re-requests) → pending …
 *
 * It is ADVISORY: a quote can always be sent / won regardless of state.
 */

export type ValidationStatus = "pending" | "approved" | "rejected";

/** Manager-facing label for the current state. */
export const VALIDATION_LABEL: Record<ValidationStatus, string> = {
  pending: "Awaiting review",
  approved: "Approved",
  rejected: "Changes requested",
};

/** One-line meaning, shown under the badge. */
export const VALIDATION_HELP: Record<ValidationStatus, string> = {
  pending: "Sent to management for a second opinion — sending isn't blocked.",
  approved: "A manager reviewed this and is happy for it to go out.",
  rejected: "A manager suggested changes before this goes to the client.",
};

/** Tailwind badge classes per state (literal, so they're not purged). */
export const VALIDATION_BADGE: Record<ValidationStatus, string> = {
  pending: "bg-amber-50 border-amber-200 text-amber-900",
  approved: "bg-emerald-50 border-emerald-200 text-emerald-900",
  rejected: "bg-rose-50 border-rose-200 text-rose-900",
};

/** Small dot color per state. */
export const VALIDATION_DOT: Record<ValidationStatus, string> = {
  pending: "bg-amber-500",
  approved: "bg-emerald-500",
  rejected: "bg-rose-500",
};

export function isValidationStatus(v: unknown): v is ValidationStatus {
  return v === "pending" || v === "approved" || v === "rejected";
}
