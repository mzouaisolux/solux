/**
 * ProductSummaryCard — compact, scannable summary of a task-list line.
 *
 * Lets operations / factory grasp a product's configuration at a glance
 * (CCT, optic, bracket, panel, battery, colour, logo…) without reading
 * every editor field. Pure presentation; the editable detail stays in
 * TaskLineEditor below it.
 *
 * The config keys ARE the field names the admin defined per category,
 * so we render whatever config_values carries — that's exactly the
 * operator's vocabulary. Factory overrides (if any) are shown with a
 * distinct tint so the floor sees the value that actually applies.
 */

function isTruthyFlag(v: string): boolean {
  const s = v.trim().toLowerCase();
  return s === "yes" || s === "true" || s === "oui" || s === "1" || s === "y";
}

function looksLikeLogo(key: string): boolean {
  return /logo|brand|sticker/i.test(key);
}

export function ProductSummaryCard({
  productName,
  sku,
  imageUrl,
  quantity,
  config,
  factoryOverrides,
  isManual = false,
}: {
  productName: string;
  sku?: string | null;
  imageUrl?: string | null;
  quantity: number;
  config: Record<string, string>;
  factoryOverrides?: Record<string, string>;
  /** m135 — manual item (pole/mast/non-catalog): tagged, no SKU expected. */
  isManual?: boolean;
}) {
  // Keep only entries with a real value, preserving insertion order.
  const entries = Object.entries(config ?? {}).filter(
    ([, v]) => v != null && String(v).trim() !== ""
  );
  const overrides = factoryOverrides ?? {};

  return (
    <div className="rounded-t-xl border border-b-0 border-neutral-200 bg-neutral-50/60 px-4 py-3">
      <div className="flex items-start gap-3">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt={productName}
            className="h-12 w-12 shrink-0 rounded-md border border-neutral-200 object-cover bg-white"
          />
        ) : (
          <div className="h-12 w-12 shrink-0 rounded-md border border-neutral-200 bg-white grid place-items-center text-neutral-300 text-lg">
            ◳
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-neutral-900">
              {productName}
            </span>
            {isManual && (
              <span
                className="inline-flex items-center rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700"
                title="Non-catalog manual item (e.g. pole/mast) — no Product reference."
              >
                Manual
              </span>
            )}
            {sku && (
              <span className="font-mono text-[11px] text-neutral-500">
                {sku}
              </span>
            )}
            <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-neutral-900 px-2 py-0.5 text-[11px] font-semibold text-white tabular-nums">
              ×{quantity}
            </span>
          </div>

          {entries.length === 0 ? (
            <p className="text-[11px] text-neutral-400 mt-1.5">
              {isManual
                ? "Manual item — see specifications below."
                : "No configuration captured yet."}
            </p>
          ) : (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {entries.map(([key, value]) => {
                const overridden =
                  overrides[key] != null && String(overrides[key]).trim() !== "";
                const shown = overridden ? overrides[key] : value;
                const flag = looksLikeLogo(key);
                return (
                  <span
                    key={key}
                    className={`inline-flex items-baseline gap-1 rounded-md border px-1.5 py-0.5 text-[11px] ${
                      overridden
                        ? "border-violet-200 bg-violet-50 text-violet-900"
                        : flag
                        ? "border-amber-200 bg-amber-50 text-amber-900"
                        : "border-neutral-200 bg-white text-neutral-700"
                    }`}
                    title={
                      overridden
                        ? `${key}: ${shown} (factory override — quote said "${value}")`
                        : `${key}: ${shown}`
                    }
                  >
                    <span className="text-neutral-400">{key}</span>
                    <span className="font-medium">
                      {flag && isTruthyFlag(String(shown)) ? "Yes" : shown}
                    </span>
                  </span>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
