// =====================================================================
// Solar panel dimensions — validation + normalisation (QA Round 2 quick-win).
// The field was free-text ("1722 x 1134", "1722×1134", "1722*1134",
// "1722mm", "xxxxxxxx" all passed). Normalize the accepted shapes to a single
// canonical "L × W mm" and reject the ambiguous/incomplete ones, so the same
// panel format reads identically everywhere.
// =====================================================================

export type PanelDimResult = { ok: true; value: string } | { ok: false; error: string };

/**
 * Accepts two dimensions separated by x / × / * / "by" (case-insensitive),
 * with or without a trailing unit. Returns the canonical "L × W mm".
 * Rejects: empty, a single dimension ("1722mm"), incomplete ("1722 x"),
 * non-numeric ("xxxxxxxx").
 */
export function normalizePanelDimensions(raw: string | null | undefined): PanelDimResult {
  const s = String(raw ?? "").trim();
  if (!s) {
    return { ok: false, error: "Solar panel dimensions are mandatory (e.g. 1722 × 1134 mm)." };
  }
  const nums = s.match(/\d+(?:[.,]\d+)?/g);
  if (!nums || nums.length < 2) {
    return {
      ok: false,
      error: `Enter two dimensions as L × W, e.g. "1722 × 1134 mm" (got "${s}").`,
    };
  }
  const clean = (n: string) => String(Number(n.replace(",", ".")));
  return { ok: true, value: `${clean(nums[0])} × ${clean(nums[1])} mm` };
}
