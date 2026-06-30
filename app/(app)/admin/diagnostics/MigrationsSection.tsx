/**
 * Migrations section of /admin/diagnostics (audit 2026-06-11, P0).
 *
 * Answers ONE question: "which migrations are actually live in THIS
 * database?" Two complementary signals, both read-only:
 *
 *   1. Probes — admin_migration_probes() RPC (m113) checks one
 *      distinctive artifact per critical migration straight in the
 *      Postgres catalogs. A red probe = the migration is NOT applied.
 *   2. Ledger — schema_migrations rows (m113). Reliable from m113
 *      onward (every new migration self-records); pre-113 files are
 *      expected to be absent here — the probes cover them.
 *
 * Defensive like HealthSection: if the RPC / table aren't deployed yet
 * (m113 not applied), we render an inline notice instead of crashing.
 * Design: existing .ad-* / .sx-* classes + tokens only — no new styles.
 */

type Probe = { file: string; label: string; kind: string; ok: boolean };
type LedgerRow = { filename: string; applied_at: string | null };

export function MigrationsSection({
  probes,
  probesError,
  ledger,
  ledgerError,
  diskFiles,
}: {
  probes: Probe[] | null;
  probesError: string | null;
  ledger: LedgerRow[] | null;
  ledgerError: string | null;
  diskFiles: string[] | null;
}) {
  const header = (
    <div
      className="sx-micro"
      style={{
        margin: "18px 0 8px",
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap",
      }}
    >
      Migrations · applied-schema registry
      {probes && (
        <span
          style={{
            fontWeight: 600,
            textTransform: "none",
            letterSpacing: 0,
            color: "var(--sx-mute-2)",
          }}
        >
          {(() => {
            const missing = probes.filter((p) => !p.ok).length;
            return missing === 0
              ? `· all ${probes.length} critical migrations detected`
              : `· ${missing} of ${probes.length} NOT detected`;
          })()}
        </span>
      )}
    </div>
  );

  // m113 not applied yet → one clear instruction, nothing else to show.
  if (probesError || !probes) {
    return (
      <>
        {header}
        <div className="ad-callout warn">
          <b>Migration registry unavailable</b> ·{" "}
          {probesError ??
            "admin_migration_probes() returned no data. Apply migration 113_schema_migrations_ledger.sql in the Supabase SQL editor and reload."}
        </div>
      </>
    );
  }

  // Missing artifacts first — that's what the operator must act on.
  const sorted = [...probes].sort((a, b) =>
    a.ok === b.ok ? a.file.localeCompare(b.file) : a.ok ? 1 : -1
  );
  const ledgerSet = new Set((ledger ?? []).map((r) => r.filename));
  const unrecorded = (diskFiles ?? []).filter((f) => !ledgerSet.has(f));

  return (
    <>
      {header}

      <div
        style={{
          border: "1px solid var(--sx-line)",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(330px, 1fr))",
        }}
      >
        {sorted.map((p) => (
          <div
            key={p.file}
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 8,
              padding: "8px 12px",
              borderBottom: "1px solid var(--sx-line)",
              borderRight: "1px solid var(--sx-line)",
              background: p.ok ? "transparent" : "var(--sx-amber-tint)",
            }}
          >
            <span
              aria-hidden
              style={{
                fontWeight: 700,
                color: p.ok ? "var(--sx-green)" : "var(--sx-amber-deep)",
              }}
            >
              {p.ok ? "✓" : "✗"}
            </span>
            <span style={{ minWidth: 0 }}>
              <span
                className="ad-mono"
                style={{
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: p.ok ? "var(--sx-ink)" : "var(--sx-amber-deep)",
                }}
              >
                {p.file.replace(/\.sql$/, "")}
              </span>
              <span
                style={{
                  display: "block",
                  fontSize: 11,
                  color: p.ok ? "var(--sx-mute)" : "var(--sx-amber-deep)",
                }}
              >
                {p.label}
                {!p.ok && (
                  <b> — NOT detected: apply it in the Supabase SQL editor.</b>
                )}
              </span>
            </span>
          </div>
        ))}
      </div>

      {/* Ledger status — bookkeeping signal, secondary to the probes. */}
      {ledgerError || !ledger ? (
        <div className="ad-callout warn" style={{ marginTop: 10 }}>
          <b>Ledger table unreadable</b> ·{" "}
          {ledgerError ?? "schema_migrations returned no data."}
        </div>
      ) : (
        <div
          style={{
            marginTop: 10,
            fontSize: 11.5,
            color: "var(--sx-mute)",
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          <div>
            Ledger: <b style={{ color: "var(--sx-ink)" }}>{ledger.length}</b>{" "}
            migration{ledger.length === 1 ? "" : "s"} recorded
            {ledger.length > 0 && (
              <>
                {" "}
                · latest{" "}
                <span className="ad-mono">
                  {ledger[ledger.length - 1]?.filename}
                </span>
              </>
            )}
            . Pre-113 files are expected to be missing here — the probes
            above cover them.
          </div>
          {diskFiles && unrecorded.length > 0 && (
            <details>
              <summary style={{ cursor: "pointer" }}>
                {unrecorded.length} file{unrecorded.length === 1 ? "" : "s"} on
                disk not recorded in the ledger
              </summary>
              <div
                className="ad-mono"
                style={{
                  fontSize: 10.5,
                  color: "var(--sx-mute-2)",
                  marginTop: 4,
                  columns: 3,
                }}
              >
                {unrecorded.map((f) => (
                  <div key={f}>{f}</div>
                ))}
              </div>
            </details>
          )}
          <div style={{ color: "var(--sx-mute-2)" }}>
            Rule going forward: every new migration ends with{" "}
            <span className="ad-mono">
              insert into schema_migrations (filename) values
              (&apos;NNN_name.sql&apos;) on conflict do nothing;
            </span>
          </div>
        </div>
      )}
    </>
  );
}
