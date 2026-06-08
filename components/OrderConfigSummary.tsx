import Link from "next/link";

/**
 * OrderConfigSummary — compact, read-only "what was ordered" card.
 *
 * Surfaced on the production order detail page so Sales (and anyone
 * else tracking the order) can read the configuration without
 * bouncing to the task list editing screen.
 *
 * Once production has started, the task list page is the wrong place
 * for Sales — it's a configuration editor. This card replaces that
 * need with a glanceable summary:
 *
 *   AOSPERF100 · 200 units
 *   Color: 4000K · Optic: 25° · Bracket: Pole · Panel: 60W
 *
 * Keeps the same row pattern Sales sees on the quotation document
 * itself. Internal-only fields (technical_values, factory_overrides)
 * are deliberately omitted — Sales rarely needs them at tracking
 * stage and they'd clutter the card.
 *
 * Empty state: when the order has no linked task list yet (rare —
 * happens during the gap between quotation-won and task-list-create),
 * the card hides itself entirely. Parent page should not mount it.
 */

export type OrderConfigLine = {
  /** Line id — React key only. */
  id: string;
  /** Product display name. Falls back to "—" when missing. */
  productName: string;
  /** Optional SKU shown next to the name in mono. */
  productSku?: string | null;
  quantity: number;
  /** Sales-visible config_values flattened to a list of "Label: Value"
   *  pairs. Internal_only / technical_values are filtered out by the
   *  parent before passing in. */
  configEntries: Array<{ label: string; value: string }>;
};

export function OrderConfigSummary({
  lines,
  taskListId,
  taskListNumber,
}: {
  lines: OrderConfigLine[];
  /** Used to render the "View full task list →" link in the header.
   *  When null, the link doesn't render (e.g. PO has no TL yet). */
  taskListId: string | null;
  taskListNumber: string | null;
}) {
  if (lines.length === 0) return null;

  return (
    <section className="panel p-5">
      <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
        <div>
          <div className="eyebrow">Order configuration</div>
          <p className="text-xs text-neutral-500 mt-0.5 max-w-xl">
            What this order produces. Read-only summary of the validated
            task list — full configuration lives on the task list page.
          </p>
        </div>
        {taskListId && (
          <Link
            href={`/task-lists/${taskListId}`}
            className="text-[11px] text-neutral-600 hover:text-neutral-900 hover:underline shrink-0"
          >
            View full task list{" "}
            <span className="font-mono">{taskListNumber ?? ""}</span> →
          </Link>
        )}
      </div>

      <ul className="space-y-3">
        {lines.map((l) => (
          <li
            key={l.id}
            className="rounded-md border border-neutral-200/80 bg-neutral-50/40 px-3 py-2.5"
          >
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <span className="text-sm font-semibold text-neutral-900">
                  {l.productName}
                </span>
                {l.productSku && (
                  <span className="ml-2 text-[11px] font-mono text-neutral-500">
                    {l.productSku}
                  </span>
                )}
              </div>
              <span className="text-xs font-semibold tabular-nums text-neutral-700 shrink-0">
                {l.quantity.toLocaleString()} units
              </span>
            </div>
            {l.configEntries.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-neutral-600">
                {l.configEntries.map((e, i) => (
                  <span key={i} className="inline-flex items-baseline gap-1">
                    <span className="text-neutral-400">{e.label}:</span>
                    <span className="text-neutral-800 font-medium">
                      {e.value}
                    </span>
                  </span>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
