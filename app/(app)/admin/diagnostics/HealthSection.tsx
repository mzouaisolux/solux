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

/** Severity → mockup health-card class (ok = green left-bar, warn/bad = amber). */
const SEV_CLASS: Record<SeverityTier, string> = {
  ok: "ok",
  warn: "warn",
  crit: "bad",
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
      <>
        <div className="sx-micro" style={{ margin: "18px 0 8px" }}>
          Health · cross-table sanity
        </div>
        <div className="ad-callout warn">
          <b>Health data unavailable</b> ·{" "}
          {error ??
            "RPC admin_diagnostics_health() returned no data. Apply migration 034 in Supabase and reload."}
        </div>
      </>
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
    <>
      <div
        className="sx-micro"
        style={{ margin: "18px 0 8px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}
      >
        Health · cross-table sanity
        <span style={{ fontWeight: 600, textTransform: "none", letterSpacing: 0, color: "var(--sx-mute-2)" }}>
          {totalCritical === 0
            ? "· all clear"
            : `· ${totalCritical} item${totalCritical === 1 ? "" : "s"} to look at`}
        </span>
      </div>

      <div className="ad-health-grid">
        {cards.map((c) => (
          <div key={c.title} className={`ad-health ${SEV_CLASS[c.tier]}`}>
            <div className="hn">{c.section.count}</div>
            <div className="ht">{c.title}</div>
            {c.section.samples.length > 0 && (
              <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 2, margin: 0 }}>
                {c.section.samples.slice(0, 4).map((s) => {
                  const label = c.formatSample(s);
                  const href = c.linkFor?.(s) ?? null;
                  return (
                    <li key={s.id} style={{ fontSize: 11, color: "var(--sx-mute)" }}>
                      {href ? (
                        <Link href={href} className="sx-link" style={{ fontWeight: 500 }}>
                          {label}
                        </Link>
                      ) : (
                        <span>{label}</span>
                      )}
                    </li>
                  );
                })}
                {c.section.count > 4 && (
                  <li style={{ fontSize: 10, color: "var(--sx-mute-2)", fontStyle: "italic" }}>
                    + {c.section.count - 4} more…
                  </li>
                )}
              </ul>
            )}
            {c.deepLink && c.section.count > 0 && (
              <Link href={c.deepLink.href} className="ha">
                {c.deepLink.label}
              </Link>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
