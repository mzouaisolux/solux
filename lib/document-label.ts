// =====================================================================
// Business-facing names for commercial documents (proforma-first).
//
// SOLUX reality (owner 2026-07-03): "default follows reality" — 99% of the
// documents sent to clients are PROFORMAS; quotations are the exception. The
// app must speak that vocabulary instead of the internal enum.
//
// The pipeline object the rep creates → negotiates → wins → launches is
// internally `type='quotation'` (unchanged, so launchProduction + the whole
// workflow keep working); to the user it IS the **Proforma**. The
// system-generated `type='proforma'` at Launch Production is the internal
// **Order confirmation** (the command) — labelling it distinctly also removes
// the "proforma draft" contradiction that used to leak onto live orders.
//
// DISPLAY-ONLY. The `documents.type` column, statuses, guards and numbering
// are untouched. No migration.
// =====================================================================

/** Title-case business name, e.g. "Proforma" / "Order confirmation". */
export function documentKindLabel(type: string | null | undefined): string {
  return type === "proforma" ? "Order confirmation" : "Proforma";
}

/** Lowercase inline variant, e.g. "this proforma". */
export function documentKindLower(type: string | null | undefined): string {
  return documentKindLabel(type).toLowerCase();
}
