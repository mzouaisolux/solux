"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  saveLineLighting,
  confirmLineLighting,
  autoPopulateLineLighting,
  setLineLightingMode,
  applyLightingToEligibleLines,
} from "@/app/(app)/task-lists/[id]/line-lighting";
import {
  LINE_LIGHTING_STATUS_LABEL,
  validateLineValues,
  type LineLightingSetup,
  type LineLightingStatus,
  type LineLightingValues,
  type ProgrammingRequirement,
} from "@/lib/lighting/line-setup";
import { RULE_OUTCOME_LABELS } from "@/lib/lighting/programming-rules";
import type { LightingProgramPeriod } from "@/lib/lighting/types";

/**
 * PER-LINE PROGRAMMING (m180) — each eligible product line owns its own
 * Lighting Setup. Automatic mode shows the study's RECOMMENDED values beside
 * the TLM's FINAL values and stays fully editable; Manual mode is structured
 * entry. Every mode switch archives the outgoing state; "Apply to all
 * eligible" is an explicit one-time copy.
 */

export type PanelLine = {
  id: string;
  name: string;
  sku: string | null;
  quantity: number;
  requirement: ProgrammingRequirement;
  status: LineLightingStatus;
  setup: LineLightingSetup | null;
  newerStudy: boolean;
};

const STATUS_STYLE: Record<LineLightingStatus, string> = {
  complete: "border-emerald-200 bg-emerald-50 text-emerald-800",
  needs_review: "border-amber-300 bg-amber-50 text-amber-900",
  missing: "border-rose-200 bg-rose-50 text-rose-700",
  not_applicable: "border-neutral-200 bg-neutral-100 text-neutral-500",
};

export function LineLightingPanel({
  taskListId,
  lines,
  editable,
  studyAvailable,
  studyName,
}: {
  taskListId: string;
  lines: PanelLine[];
  editable: boolean;
  studyAvailable: boolean;
  studyName: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const run = (fn: (fd: FormData) => Promise<void>, fd: FormData) => {
    setError(null);
    startTransition(async () => {
      try {
        await fn(fd);
        router.refresh();
      } catch (e: any) {
        setError(e?.message ?? "Operation failed.");
      }
    });
  };

  const act = (fn: (fd: FormData) => Promise<void>, lineId: string, extra?: Record<string, string>) => {
    const fd = new FormData();
    fd.set("line_id", lineId);
    for (const [k, v] of Object.entries(extra ?? {})) fd.set(k, v);
    run(fn, fd);
  };

  const visible = lines.filter((l) => l.requirement !== "not_applicable");
  const na = lines.length - visible.length;

  return (
    <section
      id="tl-line-programming"
      className="rounded-lg border border-neutral-200 bg-white p-4 space-y-3"
      data-testid="line-lighting-panel"
    >
      <div>
        <div className="eyebrow">Programming per product line</div>
        <p className="mt-0.5 max-w-3xl text-xs text-neutral-500">
          Each eligible line owns its own operating program — automatic from
          the approved study, or manual. Which lines require programming is
          decided by the central rules (Admin → Programming rules).
          {na > 0 && ` ${na} line${na === 1 ? "" : "s"} not applicable.`}
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>
      )}

      {visible.length === 0 ? (
        <p className="text-xs text-neutral-500">No lines require or allow programming on this order.</p>
      ) : (
        <ul className="divide-y divide-neutral-100 rounded-md border border-neutral-200">
          {visible.map((l) => (
            <li key={l.id}>
              <button
                type="button"
                onClick={() => setOpen(open === l.id ? null : l.id)}
                className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left hover:bg-neutral-50"
                data-testid={`line-programming-${l.id}`}
              >
                <span className="text-xs font-medium text-neutral-900">{l.name}</span>
                {l.sku && <span className="text-[11px] text-neutral-400">{l.sku}</span>}
                <span className="text-[11px] tabular-nums text-neutral-500">×{l.quantity}</span>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] ${STATUS_STYLE[l.status]}`}>
                  {LINE_LIGHTING_STATUS_LABEL[l.status]}
                </span>
                <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-[10px] text-neutral-500">
                  {RULE_OUTCOME_LABELS[l.requirement]}
                </span>
                {l.setup && (
                  <span className="text-[10px] uppercase tracking-wide text-neutral-400">
                    {l.setup.mode}
                    {l.setup.source.kind === "copy" && l.setup.source.copied_from
                      ? ` · copied from ${l.setup.source.copied_from}`
                      : ""}
                  </span>
                )}
                {l.newerStudy && (
                  <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] text-sky-800">
                    newer study available
                  </span>
                )}
              </button>

              {open === l.id && (
                <LineEditor
                  // D1 — LineEditor seeds its `values` state from setup.final
                  // through a LAZY useState initialiser, which runs only on
                  // mount. router.refresh() delivers fresh props but React
                  // keeps the same instance, so the inputs kept showing the OLD
                  // values while the recommendation block above them already
                  // showed the new study — and the next "Save programming"
                  // wrote those stale values back over the freshly imported
                  // ones (silent data loss). Keying on audit.updated_at
                  // remounts the editor exactly when the server state changed:
                  // all 8 mutation paths in lib/lighting/line-setup.ts stamp it.
                  key={`${l.id}:${l.setup?.audit.updated_at ?? "none"}`}
                  line={l}
                  editable={editable}
                  busy={busy}
                  studyAvailable={studyAvailable}
                  studyName={studyName}
                  onSave={(values) =>
                    act(saveLineLighting, l.id, { values: JSON.stringify(values) })
                  }
                  onConfirm={() => act(confirmLineLighting, l.id)}
                  onAuto={(confirm) =>
                    act(autoPopulateLineLighting, l.id, confirm ? { confirm: "1" } : {})
                  }
                  onMode={(mode, confirm) =>
                    act(setLineLightingMode, l.id, { mode, ...(confirm ? { confirm: "1" } : {}) })
                  }
                  onApplyAll={() => act(applyLightingToEligibleLines, l.id)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ------------------------------- line editor ------------------------------- */

function LineEditor({
  line,
  editable,
  busy,
  studyAvailable,
  studyName,
  onSave,
  onConfirm,
  onAuto,
  onMode,
  onApplyAll,
}: {
  line: PanelLine;
  editable: boolean;
  busy: boolean;
  studyAvailable: boolean;
  studyName: string | null;
  onSave: (values: LineLightingValues) => void;
  onConfirm: () => void;
  /** D2 — `confirm` is required when the line is in Manual mode: the import
   *  switches it back to Automatic and discards the hand-entered values. */
  onAuto: (confirm?: boolean) => void;
  onMode: (mode: "automatic" | "manual", confirm?: boolean) => void;
  onApplyAll: () => void;
}) {
  const s = line.setup;
  const [values, setValues] = useState<LineLightingValues>(() =>
    s
      ? JSON.parse(JSON.stringify(s.final))
      : {
          operating_hours: null,
          program: [],
          dusk_to_dawn: false,
          autonomous: false,
          control_mode: null,
          controller: { type: null, config: {} },
          factory_instructions: null,
        }
  );
  const check = validateLineValues(values);
  const input = "rounded-md border border-neutral-200 px-2 py-1 text-xs";

  const setStage = (i: number, patch: Partial<LightingProgramPeriod>) =>
    setValues((v) => ({
      ...v,
      program: v.program.map((p, j) => (j === i ? { ...p, ...patch } : p)),
    }));

  return (
    <div className="space-y-3 border-t border-neutral-100 bg-neutral-50/60 px-3 py-3">
      {/* Mode + population */}
      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Mode</span>
          <button
            type="button"
            disabled={busy || !studyAvailable}
            title={studyAvailable ? "" : "No approved study extraction on this command"}
            onClick={() =>
              s?.mode === "manual"
                ? window.confirm(
                    "Switching to Automatic replaces the current values with the study's recommendation.\n\nYour manual values are kept in the history. Continue?"
                  ) && onMode("automatic", true)
                : s
                  ? undefined
                  : onAuto()
            }
            className={`rounded-md border px-2.5 py-1 text-[11px] disabled:opacity-50 ${
              s?.mode === "automatic"
                ? "border-solux bg-solux text-white"
                : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100"
            }`}
            data-testid="mode-automatic"
          >
            Automatic{studyName ? ` (${studyName.slice(0, 24)}…)` : ""}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => (s?.mode === "manual" ? undefined : onMode("manual"))}
            className={`rounded-md border px-2.5 py-1 text-[11px] ${
              s?.mode === "manual" || !s
                ? s?.mode === "manual"
                  ? "border-solux bg-solux text-white"
                  : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100"
                : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100"
            }`}
            data-testid="mode-manual"
          >
            Manual
          </button>
          {!s && studyAvailable && (
            <button
              type="button"
              disabled={busy}
              // Wrapped: passing `onAuto` directly would hand the click event
              // through as the `confirm` flag (truthy).
              onClick={() => onAuto()}
              className="rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] font-medium text-indigo-900 hover:bg-indigo-100"
              data-testid="auto-populate"
            >
              ✨ Populate from the study
            </button>
          )}
          {line.newerStudy && s && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                // D2 — on a Manual line the import silently switched the mode
                // back to Automatic; the old wording never said so.
                const manual = s?.mode === "manual";
                const ok = window.confirm(
                  manual
                    ? "A newer approved study extraction exists.\n\nImporting it switches this line back to AUTOMATIC and replaces your manual values.\n\nThey are kept in the history. Continue?"
                    : "A newer approved study extraction exists. Import its recommendation?\n\nCurrent values are kept in the history."
                );
                if (ok) onAuto(manual);
              }}
              className="rounded-md border border-sky-300 bg-sky-50 px-2.5 py-1 text-[11px] font-medium text-sky-900 hover:bg-sky-100"
              data-testid="import-newer-study"
            >
              Import updated study values
            </button>
          )}
        </div>
      )}

      {/* Recommended (study) values — always visible beside the final ones */}
      {s?.recommended && (
        <div className="rounded-md border border-indigo-100 bg-indigo-50/60 px-3 py-2 text-[11px] text-indigo-900">
          <b>Recommended by the study</b>
          {s.recommended.source_document ? ` — ${s.recommended.source_document}` : ""}:{" "}
          {s.recommended.values.operating_hours != null && `${s.recommended.values.operating_hours}h/night · `}
          {s.recommended.values.program.length > 0
            ? s.recommended.values.program
                .map((p) => `${p.duration_hours}h @${p.output}%${p.presence_detection ? " +PIR" : ""}`)
                .join(" → ")
            : "no schedule"}
          {s.recommended.confidence?.lighting_program != null &&
            ` · confidence ${Math.round((s.recommended.confidence.lighting_program ?? 0) * 100)}%`}
          {s.recommended.extracted_at && ` · extracted ${s.recommended.extracted_at.slice(0, 10)}`}
        </div>
      )}

      {/* FINAL values — the TLM's word; editable in both modes */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <label className="block">
          <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-neutral-500">Hours / night</span>
          <input
            type="number"
            step="0.5"
            value={values.operating_hours ?? ""}
            disabled={!editable}
            onChange={(e) =>
              setValues((v) => ({
                ...v,
                operating_hours: e.target.value === "" ? null : Number(e.target.value),
              }))
            }
            className={`${input} w-full`}
          />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-neutral-500">Control mode</span>
          <input
            value={values.control_mode ?? ""}
            disabled={!editable}
            placeholder="time control, PIR…"
            onChange={(e) => setValues((v) => ({ ...v, control_mode: e.target.value || null }))}
            className={`${input} w-full`}
          />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-neutral-500">Controller</span>
          <input
            value={values.controller.type ?? ""}
            disabled={!editable}
            placeholder="controller type"
            onChange={(e) =>
              setValues((v) => ({ ...v, controller: { ...v.controller, type: e.target.value || null } }))
            }
            className={`${input} w-full`}
          />
        </label>
        <div className="flex items-end gap-3 pb-1">
          <label className="inline-flex items-center gap-1 text-[11px] text-neutral-700">
            <input
              type="checkbox"
              checked={values.dusk_to_dawn}
              disabled={!editable}
              onChange={(e) => setValues((v) => ({ ...v, dusk_to_dawn: e.target.checked }))}
              className="h-3.5 w-3.5 rounded border-neutral-300"
            />
            Dusk-to-dawn
          </label>
          <label className="inline-flex items-center gap-1 text-[11px] text-neutral-700">
            <input
              type="checkbox"
              checked={values.autonomous}
              disabled={!editable}
              onChange={(e) => setValues((v) => ({ ...v, autonomous: e.target.checked }))}
              className="h-3.5 w-3.5 rounded border-neutral-300"
            />
            Autonomous
          </label>
        </div>
      </div>

      {/* Stages */}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wide text-neutral-500">Dimming stages</span>
          {editable && (
            <button
              type="button"
              onClick={() =>
                setValues((v) => ({
                  ...v,
                  program: [...v.program, { output: 100, duration_hours: 1 }],
                }))
              }
              className="text-[11px] text-neutral-600 underline decoration-neutral-300 hover:decoration-neutral-500"
            >
              + Add stage
            </button>
          )}
        </div>
        {values.program.length === 0 ? (
          <p className="text-[11px] text-neutral-400">No stages{values.dusk_to_dawn ? " — dusk-to-dawn" : ""}.</p>
        ) : (
          <ul className="space-y-1">
            {values.program.map((p, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 text-[11px]">
                <span className="w-4 text-neutral-400">{i + 1}.</span>
                <input
                  type="number" min={0} max={100}
                  value={p.output}
                  disabled={!editable}
                  onChange={(e) => setStage(i, { output: Number(e.target.value) })}
                  className={`${input} w-16`}
                  aria-label={`Stage ${i + 1} output %`}
                />
                <span className="text-neutral-500">%</span>
                <input
                  type="number" min={0} step="0.5"
                  value={p.duration_hours}
                  disabled={!editable}
                  onChange={(e) => setStage(i, { duration_hours: Number(e.target.value) })}
                  className={`${input} w-16`}
                  aria-label={`Stage ${i + 1} duration h`}
                />
                <span className="text-neutral-500">h</span>
                <label className="inline-flex items-center gap-1 text-neutral-600">
                  <input
                    type="checkbox"
                    checked={p.presence_detection === true}
                    disabled={!editable}
                    onChange={(e) =>
                      setStage(i, {
                        presence_detection: e.target.checked,
                        detection_output: e.target.checked ? (p.detection_output ?? 100) : null,
                      })
                    }
                    className="h-3 w-3 rounded border-neutral-300"
                  />
                  motion sensor
                </label>
                {p.presence_detection && (
                  <>
                    <span className="text-neutral-500">boost</span>
                    <input
                      type="number" min={0} max={100}
                      value={p.detection_output ?? 100}
                      disabled={!editable}
                      onChange={(e) => setStage(i, { detection_output: Number(e.target.value) })}
                      className={`${input} w-14`}
                      aria-label={`Stage ${i + 1} boost %`}
                    />
                    <span className="text-neutral-500">%</span>
                  </>
                )}
                {editable && (
                  <button
                    type="button"
                    onClick={() =>
                      setValues((v) => ({ ...v, program: v.program.filter((_, j) => j !== i) }))
                    }
                    className="text-neutral-400 hover:text-rose-600"
                    aria-label={`Remove stage ${i + 1}`}
                  >
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <label className="block">
        <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-neutral-500">
          Factory programming instructions
        </span>
        <textarea
          rows={2}
          value={values.factory_instructions ?? ""}
          disabled={!editable}
          onChange={(e) => setValues((v) => ({ ...v, factory_instructions: e.target.value || null }))}
          className={`${input} w-full`}
        />
      </label>

      {(check.errors.length > 0 || check.warnings.length > 0) && (
        <div className="space-y-0.5 text-[11px]">
          {check.errors.map((e, i) => (
            <p key={`e${i}`} className="text-rose-700">✕ {e}</p>
          ))}
          {check.warnings.map((w, i) => (
            <p key={`w${i}`} className="text-amber-700">⚠ {w}</p>
          ))}
        </div>
      )}

      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy || check.errors.length > 0}
            onClick={() => onSave(values)}
            className="rounded-md border border-solux bg-solux px-3 py-1.5 text-xs font-medium text-white hover:bg-solux/90 disabled:opacity-60"
            data-testid="save-line-lighting"
          >
            {busy ? "Saving…" : "Save programming"}
          </button>
          {s?.mode === "automatic" && s.review.state === "unreviewed" && (
            <button
              type="button"
              disabled={busy}
              onClick={onConfirm}
              className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
              data-testid="confirm-line-lighting"
            >
              Confirm study values
            </button>
          )}
          {s && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                window.confirm(
                  "Copy this programming to every eligible line that has none yet?\n\nCopies are independent — later edits here will NOT propagate."
                ) && onApplyAll()
              }
              className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50"
              data-testid="apply-to-all"
            >
              Apply to all eligible lines
            </button>
          )}
          {s && (
            <span className="ml-auto text-[11px] text-neutral-400">
              {s.history.length > 0 && `${s.history.length} history entr${s.history.length === 1 ? "y" : "ies"} · `}
              {s.audit.updated_at
                ? `updated ${s.audit.updated_at.slice(0, 10)}`
                : ""}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
