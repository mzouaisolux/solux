import Link from "next/link";
import type { CustomerHistory } from "@/lib/import/history-stats";

/**
 * Rebuilt commercial history for a customer, from imported historical invoices.
 * Read-only. These figures come ONLY from the import island (status='imported')
 * — they never mix into the live pipeline (/business, /forecast, won-revenue).
 */

function fmtMoney(map: Record<string, number>): string {
  const keys = Object.keys(map).filter((k) => k !== "—");
  const use = keys.length ? keys : Object.keys(map);
  if (use.length === 0) return "—";
  return use
    .sort((a, b) => (a === "USD" ? -1 : b === "USD" ? 1 : a.localeCompare(b)))
    .map(
      (k) =>
        `${k === "—" ? "" : k + " "}${map[k].toLocaleString(undefined, {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        })}`
    )
    .join("  ·  ");
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  const t = Date.parse(d);
  if (Number.isNaN(t)) return d;
  return new Date(t).toLocaleDateString("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

export function ClientHistoryPanel({
  clientId,
  clientName,
  history,
}: {
  clientId: string;
  clientName: string;
  history: CustomerHistory;
}) {
  if (history.count === 0) {
    return (
      <div className="panel p-12 text-center">
        <div className="eyebrow">Historical invoices</div>
        <h3 className="mt-1 text-lg font-semibold text-neutral-900">
          No history imported yet
        </h3>
        <p className="mx-auto mt-1 max-w-md text-sm text-neutral-500">
          Import {clientName}&rsquo;s old PDF invoices and the ERP will rebuild
          years of commercial history here automatically.
        </p>
        <div className="mt-5">
          <Link href={`/clients/${clientId}/import-invoices`} className="btn-primary">
            Import historical invoices
          </Link>
        </div>
      </div>
    );
  }

  const largest = history.largestOrder;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="eyebrow">Commercial history</div>
          <p className="text-sm text-neutral-500">
            Rebuilt from {history.count} imported invoice
            {history.count === 1 ? "" : "s"}.
          </p>
        </div>
        <Link
          href={`/clients/${clientId}/import-invoices`}
          className="btn-secondary text-[12px]"
        >
          Import more
        </Link>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Kpi label="First order" value={fmtDate(history.firstOrder?.date ?? null)} hint={history.firstOrder?.number ?? undefined} />
        <Kpi label="Last order" value={fmtDate(history.lastOrder?.date ?? null)} hint={history.lastOrder?.number ?? undefined} />
        <Kpi label="Invoices" value={String(history.count)} />
        <Kpi label="Lifetime revenue" value={fmtMoney(history.lifetimeRevenueByCurrency)} tone="emerald" />
        <Kpi label="Average order" value={fmtMoney(history.averageOrderValueByCurrency)} />
        <Kpi
          label="Largest order"
          value={largest ? `${largest.currency === "—" ? "" : largest.currency + " "}${largest.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"}
          hint={largest?.number ?? undefined}
          tone="emerald"
        />
      </div>

      {/* Products purchased */}
      {history.productsPurchased.length > 0 && (
        <section className="panel p-4">
          <div className="eyebrow mb-2">Products purchased</div>
          <div className="flex flex-wrap gap-1.5">
            {history.productsPurchased.slice(0, 40).map((p, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-2.5 py-0.5 text-[12px] text-neutral-700"
              >
                {p.name}
                <span className="tabular-nums text-[10.5px] text-neutral-400">×{p.orders}</span>
              </span>
            ))}
            {history.productsPurchased.length > 40 && (
              <span className="text-[11px] text-neutral-400">
                +{history.productsPurchased.length - 40} more
              </span>
            )}
          </div>
        </section>
      )}

      {/* Purchase timeline */}
      <section className="panel p-4">
        <div className="eyebrow mb-3">Purchase timeline</div>
        <ol className="relative space-y-4 border-l border-neutral-200 pl-5">
          {history.timeline.map((y) => (
            <li key={y.year} className="relative">
              <span className="absolute -left-[26px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-solux ring-4 ring-white" />
              <div className="text-[13px] font-bold text-neutral-900">{y.year}</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {y.docs.map((d) => (
                  <span
                    key={d.id}
                    className="rounded border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 font-mono text-[11px] text-neutral-600"
                  >
                    {d.number ?? "—"}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "emerald";
}) {
  return (
    <div className="panel p-4">
      <div className="eyebrow">{label}</div>
      <div
        className={`mt-1 text-xl font-bold tabular-nums leading-tight ${
          tone === "emerald" ? "text-emerald-700" : "text-neutral-900"
        }`}
      >
        {value}
      </div>
      {hint && (
        <div className="mt-0.5 truncate font-mono text-[10.5px] text-neutral-400">{hint}</div>
      )}
    </div>
  );
}
