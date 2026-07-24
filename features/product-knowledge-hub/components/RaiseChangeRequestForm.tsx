"use client";

/**
 * Raise a spec change request for a family.
 *
 * Operations edits the common values and any model values, writes a reason,
 * and submits. The diff is computed client-side (computeDiff is pure) and only
 * genuinely-changed values are sent. On submit the draft request is created via
 * the server action; the operator then attaches evidence / submits from the
 * request (this slice keeps the form to draft creation to stay focused).
 */

import { useMemo, useState, useTransition } from "react";
import { computeDiff, type ProposedChanges } from "../lib/diff";
import { createChangeRequest, submitRequest } from "../actions";
import type { FamilyDatasheet, ResolvedSpec } from "../lib/types";

type Props = { family: FamilyDatasheet; defaultOpen?: boolean };

function currentString(spec: ResolvedSpec): string {
  const v = spec.value;
  if (!v) return "";
  if (v.value_number != null) return String(v.value_number);
  return v.value_text ?? "";
}

/** Turn a raw input string into a {value_number|value_text} per field kind. */
function coerce(raw: string, kind: string | null): { value_number: number | null; value_text: string | null } {
  const trimmed = raw.trim();
  if (kind === "number") {
    const n = trimmed === "" ? null : Number(trimmed);
    return { value_number: Number.isFinite(n as number) ? (n as number) : null, value_text: null };
  }
  return { value_number: null, value_text: trimmed === "" ? null : trimmed };
}

export function RaiseChangeRequestForm({ family, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const [reason, setReason] = useState("");
  const [common, setCommon] = useState<Record<string, string>>(() =>
    Object.fromEntries(family.commonSpecs.map((s) => [s.field.id, currentString(s)]))
  );
  const [model, setModel] = useState<Record<string, Record<string, string>>>(() =>
    Object.fromEntries(
      family.models.map((m) => [m.id, Object.fromEntries(m.modelSpecs.map((s) => [s.field.id, currentString(s)]))])
    )
  );
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fieldKind = useMemo(() => new Map(family.fields.map((f) => [f.id, f.value_kind])), [family.fields]);

  // Model-scoped fields (matrix rows) and current per-(model,field) values so we
  // can flag edited cells. Order rows by the field's sort for a stable matrix.
  const modelFields = useMemo(
    () => family.fields.filter((f) => f.scope === "model").sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)),
    [family.fields]
  );
  const origModel = useMemo(() => {
    const m = new Map<string, string>(); // `${productId}:${fieldId}` → current string
    for (const p of family.models) for (const s of p.modelSpecs) m.set(`${p.id}:${s.field.id}`, currentString(s));
    return m;
  }, [family.models]);
  const origCommon = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of family.commonSpecs) m.set(s.field.id, currentString(s));
    return m;
  }, [family.commonSpecs]);

  function buildProposed(): ProposedChanges {
    const proposed: ProposedChanges = { common: {}, model: {} };
    for (const [fieldId, raw] of Object.entries(common)) {
      proposed.common[fieldId] = coerce(raw, fieldKind.get(fieldId) ?? null);
    }
    for (const [productId, fields] of Object.entries(model)) {
      proposed.model[productId] = {};
      for (const [fieldId, raw] of Object.entries(fields)) {
        proposed.model[productId][fieldId] = coerce(raw, fieldKind.get(fieldId) ?? null);
      }
    }
    return proposed;
  }

  const diff = computeDiff(family, buildProposed());

  function handleSubmit(alsoSubmit: boolean) {
    setError(null);
    setMessage(null);
    if (diff.length === 0) {
      setError("No changes to submit.");
      return;
    }
    startTransition(async () => {
      try {
        const id = await createChangeRequest(family.category.id, diff, reason);
        if (alsoSubmit) await submitRequest(id);
        setMessage(alsoSubmit ? "Change request submitted for approval." : "Draft change request created.");
        setOpen(false);
      } catch (e: any) {
        setError(e?.message ?? "Could not create the change request.");
      }
    });
  }

  if (!open) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", margin: "4px 0 4px" }}>
        <button type="button" className="sx-btn sx-btn-go" onClick={() => setOpen(true)}>
          Raise change request
        </button>
        {message ? <span className="sx-micro" style={{ color: "#166534" }}>{message}</span> : null}
      </div>
    );
  }

  const editStyle = (changed: boolean, extra?: React.CSSProperties): React.CSSProperties => ({
    padding: 7,
    fontSize: 13,
    width: "100%",
    background: changed ? "var(--sx-green-tint, rgba(85,255,126,.14))" : "#fff",
    border: `1px solid ${changed ? "var(--sx-green-deep, #0b7a39)" : "#dcdde1"}`,
    ...extra,
  });

  return (
    <div style={{ marginTop: 16 }}>
      <div className="sx-sectitle">
        <h2>Raise change request</h2>
        <div className="rhs">
          <button type="button" className="sx-clear" onClick={() => setOpen(false)}>
            Cancel
          </button>
        </div>
      </div>

      {/* Reason */}
      <div className="card sec">
        <div className="sx-micro" style={{ marginBottom: 6 }}>Reason</div>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          style={{ width: "100%", padding: 8, border: "1px solid #dcdde1", fontSize: 13 }}
          placeholder="Why does this specification change?"
        />
      </div>

      {/* Common — scope: common */}
      {family.commonSpecs.length > 0 && (
        <div className="card sec" style={{ marginTop: 16 }}>
          <div className="sx-sectitle">
            <h2>Common specifications</h2>
            <div className="rhs">
              <span className="sx-micro">Applies to every model</span>
            </div>
          </div>
          <div className="px-meta-grid">
            {family.commonSpecs.map((s) => {
              const val = common[s.field.id] ?? "";
              const changed = val.trim() !== (origCommon.get(s.field.id) ?? "").trim();
              return (
                <div key={s.field.id}>
                  <div className="metaLabel sx-micro">
                    {s.field.label}
                    {s.field.unit ? ` (${s.field.unit})` : ""}
                  </div>
                  <input
                    value={val}
                    onChange={(e) => setCommon((c) => ({ ...c, [s.field.id]: e.target.value }))}
                    style={editStyle(changed, { marginTop: 4 })}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Model — scope: model (matrix) */}
      {modelFields.length > 0 && family.models.length > 0 && (
        <div className="card sec" style={{ marginTop: 16 }}>
          <div className="sx-sectitle">
            <h2>Model specifications</h2>
            <div className="rhs">
              <span className="sx-micro">Varies by model</span>
            </div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="sx-list" style={{ minWidth: 560 }}>
              <thead>
                <tr>
                  <th style={{ position: "sticky", left: 0, background: "#fafafa", zIndex: 1 }}>Field</th>
                  {family.models.map((m) => (
                    <th key={m.id} className="r" title={m.name}>
                      {m.sku ?? m.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {modelFields.map((f) => (
                  <tr key={f.id}>
                    <td style={{ position: "sticky", left: 0, background: "#fff", fontWeight: 500, whiteSpace: "nowrap" }}>
                      {f.label}
                      {f.unit ? ` (${f.unit})` : ""}
                    </td>
                    {family.models.map((m) => {
                      const val = model[m.id]?.[f.id] ?? "";
                      const changed = val.trim() !== (origModel.get(`${m.id}:${f.id}`) ?? "").trim();
                      return (
                        <td key={m.id} className="r">
                          <input
                            value={val}
                            onChange={(e) =>
                              setModel((prev) => ({ ...prev, [m.id]: { ...(prev[m.id] ?? {}), [f.id]: e.target.value } }))
                            }
                            style={editStyle(changed, { minWidth: 70, textAlign: "right", padding: "5px 6px", fontSize: 12 })}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="card sec" style={{ marginTop: 16, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <span className="sx-micro" style={{ color: diff.length ? "var(--sx-green-deep, #0b7a39)" : undefined }}>
          {diff.length} change{diff.length === 1 ? "" : "s"} detected
        </span>
        <span style={{ flex: 1 }} />
        <button type="button" className="sx-btn" onClick={() => handleSubmit(false)} disabled={pending}>
          Save draft
        </button>
        <button type="button" className="sx-btn sx-btn-go" onClick={() => handleSubmit(true)} disabled={pending}>
          {pending ? "Submitting…" : "Submit for approval"}
        </button>
        {error ? <span className="sx-micro" style={{ color: "#b91c1c", flexBasis: "100%" }}>{error}</span> : null}
      </div>
    </div>
  );
}

export default RaiseChangeRequestForm;
