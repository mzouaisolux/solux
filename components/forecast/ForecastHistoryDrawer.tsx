"use client";

import { useEffect, useState } from "react";
import {
  loadForecastHistory,
  type ForecastHistoryPayload,
} from "@/app/(app)/forecast/actions";
import type { ForecastAuditEvent } from "@/lib/forecast-audit";
import { fmtMoney } from "@/lib/forecast";

/**
 * ForecastHistoryDrawer — the admin-only audit trail for ONE forecast
 * line, as a right-side overlay on /forecast.
 *
 * Shows the immutable change timeline (who changed what, when, from
 * where) plus a compact probability-evolution strip. Fetches through
 * the capability-gated server action — a sales user calling it gets a
 * permission error, and RLS blanks the table anyway.
 */

const FIELD_LABEL: Record<string, string> = {
  created: "Forecast created",
  probability: "Probability",
  expected_close_period: "Expected close",
  amount: "Amount",
  currency: "Currency",
  status: "Status",
  owner: "Sales owner",
  client: "Client",
  affair_link: "Project link",
  project_name: "Project name",
  category: "Category (legacy)",
  archived: "Archived",
};

const SOURCE_LABEL: Record<string, string> = {
  manual_edit: "Manual edit",
  excel_import: "Excel import",
  bulk_update: "Bulk update",
  erp_sync: "ERP sync",
  quotation_link: "Quotation link",
  admin_correction: "Admin correction",
  migration: "Migration",
  system: "System",
};

export function ForecastHistoryDrawer({
  documentId,
  title,
  subtitle,
  onClose,
}: {
  documentId: string;
  title: string;
  subtitle?: string;
  onClose: () => void;
}) {
  const [payload, setPayload] = useState<ForecastHistoryPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadForecastHistory(documentId)
      .then((p) => {
        if (alive) setPayload(p);
      })
      .catch((e: any) => {
        if (alive) setError(e?.message ?? "Failed to load history");
      });
    return () => {
      alive = false;
    };
  }, [documentId]);

  const events = payload?.events ?? [];
  const userLabel = (id: string | null) =>
    id ? payload?.userLabels[id] ?? id.slice(0, 8) + "…" : "—";

  // Probability evolution, oldest → newest (events arrive newest first).
  const probPoints = [...events]
    .reverse()
    .filter((e) => e.field === "probability" || e.field === "created")
    .map((e) => e.newProbability)
    .filter((p): p is number => p != null);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={`Forecast history — ${title}`}
    >
      {/* Scrim */}
      <button
        type="button"
        aria-label="Close history"
        onClick={onClose}
        className="absolute inset-0 bg-neutral-900/30"
      />

      {/* Panel */}
      <div className="relative h-full w-full max-w-md bg-white shadow-xl flex flex-col">
        <div className="px-5 py-4 border-b border-neutral-200 flex items-start justify-between gap-3">
          <div>
            <div className="eyebrow">Forecast history</div>
            <h3 className="text-sm font-semibold text-neutral-900 mt-0.5">
              {title}
            </h3>
            {subtitle && (
              <p className="text-[11px] text-neutral-500 mt-0.5">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-neutral-200 bg-white px-2 py-1 text-[11px] text-neutral-600 hover:bg-neutral-50"
          >
            Close
          </button>
        </div>

        {/* Probability evolution strip */}
        {probPoints.length > 1 && (
          <div className="px-5 py-3 border-b border-neutral-100">
            <div className="text-[10px] uppercase tracking-wider text-neutral-400 font-medium mb-1">
              Probability evolution
            </div>
            <div className="flex items-center gap-1 flex-wrap text-[11px] tabular-nums">
              {probPoints.map((p, i) => (
                <span key={i} className="flex items-center gap-1">
                  {i > 0 && <span className="text-neutral-300">→</span>}
                  <span
                    className={`font-medium ${
                      i === probPoints.length - 1
                        ? "text-neutral-900"
                        : "text-neutral-500"
                    }`}
                  >
                    {p}%
                  </span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Timeline */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error ? (
            <p className="text-xs text-rose-600">{error}</p>
          ) : payload == null ? (
            <p className="text-xs text-neutral-400">Loading history…</p>
          ) : events.length === 0 ? (
            <p className="text-xs text-neutral-400">
              No audit events for this deal yet. Events start accumulating
              once migration m158 is applied — every forecast change is
              then recorded automatically.
            </p>
          ) : (
            <ol className="space-y-4">
              {events.map((e) => (
                <li key={e.id} className="relative pl-4">
                  <span className="absolute left-0 top-1.5 h-1.5 w-1.5 rounded-full bg-neutral-300" />
                  <div className="flex items-baseline justify-between gap-2 flex-wrap">
                    <span className="text-[11px] font-medium text-neutral-900">
                      {FIELD_LABEL[e.field] ?? e.field}
                    </span>
                    <span
                      className="text-[10px] text-neutral-400 tabular-nums"
                      title={new Date(e.createdAt).toLocaleString()}
                    >
                      {new Date(e.createdAt).toLocaleDateString()}{" "}
                      {new Date(e.createdAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <div className="text-[11px] text-neutral-700 mt-0.5">
                    <ChangeLine event={e} userLabel={userLabel} />
                  </div>
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    <span className="text-[10px] text-neutral-500">
                      {userLabel(e.changedBy)}
                      {e.changedByRole ? ` · ${e.changedByRole}` : ""}
                    </span>
                    <span className="inline-flex items-center rounded-full border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 text-[9px] font-medium text-neutral-500">
                      {SOURCE_LABEL[e.changeSource] ?? e.changeSource}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="px-5 py-3 border-t border-neutral-100">
          <p className="text-[10px] text-neutral-400">
            Append-only audit trail — events are never edited or deleted.
            Management access only.
          </p>
        </div>
      </div>
    </div>
  );
}

/** Render the old → new change for one event, using the structured
 *  snapshots when available (money formatting for amounts / weighted). */
function ChangeLine({
  event: e,
  userLabel,
}: {
  event: ForecastAuditEvent;
  userLabel: (id: string | null) => string;
}) {
  const arrow = <span className="text-neutral-300 mx-1">→</span>;

  const cur = e.currency ?? "USD";

  if (e.field === "created") {
    return (
      <span>
        Entered the forecast at{" "}
        <b className="tabular-nums">{e.newProbability ?? "?"}%</b>
        {e.newAmount != null && (
          <>
            {" "}
            ({fmtMoney(e.newAmount, cur)} ·{" "}
            {e.newWeighted != null ? fmtMoney(e.newWeighted, cur) : "—"}{" "}
            weighted)
          </>
        )}
      </span>
    );
  }

  if (e.field === "probability") {
    return (
      <span className="tabular-nums">
        {e.oldProbability != null ? `${e.oldProbability}%` : "—"}
        {arrow}
        <b>{e.newProbability != null ? `${e.newProbability}%` : "—"}</b>
        {e.oldWeighted != null && e.newWeighted != null && (
          <span className="text-neutral-500">
            {" "}
            · weighted {fmtMoney(e.oldWeighted, cur)}
            {arrow}
            {fmtMoney(e.newWeighted, cur)}
          </span>
        )}
      </span>
    );
  }

  if (e.field === "amount") {
    return (
      <span className="tabular-nums">
        {e.oldAmount != null ? fmtMoney(e.oldAmount, cur) : "—"}
        {arrow}
        <b>{e.newAmount != null ? fmtMoney(e.newAmount, cur) : "—"}</b>
      </span>
    );
  }

  if (e.field === "owner") {
    return (
      <span>
        {userLabel(e.oldValue)}
        {arrow}
        <b>{userLabel(e.newValue)}</b>
      </span>
    );
  }

  return (
    <span>
      {e.oldValue ?? "—"}
      {arrow}
      <b>{e.newValue ?? "—"}</b>
    </span>
  );
}
