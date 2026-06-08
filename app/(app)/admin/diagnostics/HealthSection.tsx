import Link from "next/link";

/**
 * Health section of /admin/diagnostics.
 *
 * Reads from the admin_diagnostics_health() RPC (migration 034) and
 * renders six counter cards: drift / orphans / late deliveries.
 *
 * Defensive: if the RPC errors (migration not applied yet, transient
 * DB issue), shows an inline notice instead of crashing the page so
 * the rest of /admin/diagnostics stays usable.
 */

type Sample = {
  id: string;
  number?: string | null;
  email?: string | null;
  doc_number?: string | null;
  company_name?: string | null;
  deadline?: string | null;
};
type Section = { count: number; samples: Sample[] };
type HealthPayload = {
  task_lists_won_without_po: Section;
  docs_won_without_task_list: Section;
  pos_past_deadline_active: Section;
  docs_cancelled_with_active_tl: Section;
  clients_archived_with_active_po: Section;
  users_without_role: Section;
};

type SeverityTier = "ok" | "warn" | "crit";

/** Decide a severity from count + thresholds for tinting the card. */
function severityFor(count: number, criticalAt = 1): SeverityTier {
  if (count === 0) return "ok";
  if (count >= criticalAt) return "crit";
  return "warn";
}

const TIER_CLASSES: Record<SeverityTier, string> = {
  ok: "border-emerald-200 bg-emerald-50/40",
  warn: "border-amber-300 bg-amber-50/60",
  crit: "border-rose-300 bg-rose-50/60",
};

const TIER_DOT: Record<SeverityTier, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  crit: "bg-rose-500",
};

export function HealthSection({
  payload,
  error,
}: {
  payload: HealthPayload | null;
  error: string | null;
}) {
  if (error || !payload) {
    return (
      <section className="panel p-5 space-y-3">
        <div className="eyebrow">Health · cross-table sanity</div>
        <div className="rounded-md border border-amber-300 bg-amber-50/60 px-3 py-3 text-xs text-amber-900">
          <div className="font-semibold mb-1">Health data unavailable</div>
          <p className="text-amber-800">
            {error ??
              "RPC admin_diagnostics_health() returned no data. Apply migration 034 in Supabase and reload."}
          </p>
        </div>
      </section>
    );
  }

  // Cards in priority order — drift first (most likely to need attention),
  // then orphans, then late deliveries, then user setup gaps.
  const cards: {
    title: string;
    blurb: string;
    section: Section;
    tier: SeverityTier;
    /** Format a sample for inline display. */
    formatSample: (s: Sample) => string;
    /** Link template for individual offenders, if any. */
    linkFor?: (s: Sample) => string | null;
    /** Page to deep-link to when count > 0 and no per-sample link exists. */
    deepLink?: { href: string; label: string };
  }[] = [
    {
      title: "Lifecycle drift · cancelled docs vs active task lists",
      blurb:
        "Doc was cancelled but its task list is still alive. The cancellation trigger (migration 023) should have cascaded — investigate why it didn't.",
      section: payload.docs_cancelled_with_active_tl,
      tier: severityFor(payload.docs_cancelled_with_active_tl.count),
      formatSample: (s) =>
        `${s.number ?? "(no number)"} (from doc ${s.doc_number ?? "—"})`,
      linkFor: (s) => `/task-lists/${s.id}`,
    },
    {
      title: "Task lists ready for production without a PO",
      blurb:
        "Task list status reached validated / production_ready but no production_order was auto-created. The ensureProductionOrderForTaskList path failed silently.",
      section: payload.task_lists_won_without_po,
      tier: severityFor(payload.task_lists_won_without_po.count),
      formatSample: (s) => s.number ?? "(no number)",
      linkFor: (s) => `/task-lists/${s.id}`,
      deepLink: { href: "/operations", label: "Try Sync on /operations →" },
    },
    {
      title: "Production orders past deadline + still active",
      blurb:
        "current_production_deadline is in the past and status is not delivered or cancelled. Possible slippage — push status or move the deadline.",
      section: payload.pos_past_deadline_active,
      tier: severityFor(payload.pos_past_deadline_active.count),
      formatSample: (s) =>
        `${s.number ?? "(no number)"}${s.deadline ? ` · was due ${s.deadline}` : ""}`,
      linkFor: (s) => `/production/orders/${s.id}`,
    },
    {
      title: "Docs won without a task list",
      blurb:
        "Quotation was marked won but never spawned a task list. Either legitimate (services-only) or a sales oversight worth checking.",
      section: payload.docs_won_without_task_list,
      tier: severityFor(payload.docs_won_without_task_list.count),
      formatSample: (s) => s.number ?? "(no number)",
      linkFor: (s) => `/documents/${s.id}`,
    },
    {
      title: "Archived clients with active production",
      blurb:
        "Client was archived while still having open production orders. Either restore the client or close the PO before the archive sticks.",
      section: payload.clients_archived_with_active_po,
      tier: severityFor(payload.clients_archived_with_active_po.count),
      formatSample: (s) =>
        `${s.number ?? "(no PO number)"}${s.company_name ? ` · ${s.company_name}` : ""}`,
      linkFor: (s) => `/production/orders/${s.id}`,
    },
    {
      title: "Users without role assignment",
      blurb:
        "auth.users rows with no row in user_roles. They effectively fall through to the default ‘sales’ behavior until you assign them explicitly.",
      section: payload.users_without_role,
      tier: severityFor(payload.users_without_role.count),
      formatSample: (s) => s.email ?? s.id.slice(0, 8) + "…",
      deepLink: { href: "/admin/users", label: "Assign roles on /admin/users →" },
    },
  ];

  const totalCritical = cards.reduce(
    (acc, c) => acc + (c.tier !== "ok" ? c.section.count : 0),
    0
  );

  return (
    <section className="panel p-5 space-y-4">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <div className="eyebrow">Health · cross-table sanity</div>
          <h2 className="text-base font-semibold text-neutral-900 mt-0.5">
            Drift, orphans, late deliveries
          </h2>
        </div>
        <div className="text-[11px] text-neutral-500 flex items-center gap-2">
          <span
            className={`inline-block w-2 h-2 rounded-full ${
              totalCritical === 0 ? "bg-emerald-500" : "bg-rose-500"
            }`}
            aria-hidden
          />
          {totalCritical === 0
            ? "All clear · nothing requires attention"
            : `${totalCritical} item${totalCritical === 1 ? "" : "s"} to look at`}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {cards.map((c) => (
          <article
            key={c.title}
            className={`rounded-lg border p-4 space-y-2 ${TIER_CLASSES[c.tier]}`}
          >
            <header className="flex items-start gap-2">
              <span
                className={`inline-block w-2 h-2 rounded-full mt-1.5 ${TIER_DOT[c.tier]}`}
                aria-hidden
              />
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-neutral-900 leading-snug">
                  {c.title}
                </h3>
                <p className="text-[11px] text-neutral-600 mt-0.5">{c.blurb}</p>
              </div>
              <span
                className={`tabular-nums text-lg font-bold ${
                  c.tier === "ok"
                    ? "text-emerald-700"
                    : c.tier === "warn"
                      ? "text-amber-700"
                      : "text-rose-700"
                }`}
              >
                {c.section.count}
              </span>
            </header>

            {c.section.samples.length > 0 && (
              <ul className="space-y-1 mt-1 pl-4">
                {c.section.samples.slice(0, 5).map((s) => {
                  const label = c.formatSample(s);
                  const href = c.linkFor?.(s) ?? null;
                  return (
                    <li key={s.id} className="text-[11px] text-neutral-700">
                      {href ? (
                        <Link
                          href={href}
                          className="hover:underline hover:text-neutral-900"
                        >
                          {label}
                        </Link>
                      ) : (
                        <span>{label}</span>
                      )}
                    </li>
                  );
                })}
                {c.section.count > 5 && (
                  <li className="text-[10px] text-neutral-500 italic">
                    + {c.section.count - 5} more…
                  </li>
                )}
              </ul>
            )}

            {c.deepLink && c.section.count > 0 && (
              <div className="pt-1">
                <Link
                  href={c.deepLink.href}
                  className="text-[11px] font-medium text-neutral-700 hover:text-neutral-900 hover:underline"
                >
                  {c.deepLink.label}
                </Link>
              </div>
            )}
          </article>
        ))}
      </div>

      <p className="text-[10px] text-neutral-400 italic">
        Counts and samples are read via SECURITY DEFINER RPC — they
        reflect company-wide truth regardless of the viewer&apos;s RLS
        scope. Samples capped at 10 per category for performance.
      </p>
    </section>
  );
}
