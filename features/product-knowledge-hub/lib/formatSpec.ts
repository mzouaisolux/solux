/**
 * Single source of truth for rendering a resolved spec value as display text.
 * Used by the family page, the model page, and the datasheet renderer so the
 * three surfaces always agree.
 *
 * Unit handling: numbers get the unit appended ("38.4 Wh"); text values that
 * already carry their own unit (they end in a letter, e.g. "800*255mm",
 * "6,3 Wc") are shown as-is so we never double-print a unit.
 */

import type { ResolvedSpec } from "./types";

export function formatSpecValue(spec: ResolvedSpec | null | undefined): string {
  if (!spec) return "—";
  const v = spec.value;
  if (!v) return "—";
  const unit = (v.unit ?? spec.field.unit ?? "").trim();
  if (v.value_number != null) return unit ? `${v.value_number} ${unit}` : `${v.value_number}`;
  if (v.value_text) {
    const t = v.value_text.trim();
    if (!t) return "—";
    if (!unit) return t;
    return /[a-zA-Z]\s*$/.test(t) ? t : `${t} ${unit}`;
  }
  return "—";
}
