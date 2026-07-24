"use client";

/**
 * Schema editor (admin — spec.manage_schema). Pick a family, then add / edit /
 * delete its spec fields. Direct writes (outside the change-request flow); the
 * server actions emit spec.schema_changed for the audit trail.
 *
 * Data-protection rule surfaced in the UI: a field can only be deleted when it
 * has zero values (valueCount === 0). Otherwise Delete is disabled with a hint.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createSchemaField,
  updateSchemaField,
  deleteSchemaField,
  type SchemaFieldInput,
} from "../actions";
import type { SchemaFamily, SchemaFieldRow } from "../lib/read";
import type { SpecScope, SpecValueKind } from "../lib/types";

const SCOPES: SpecScope[] = ["common", "model"];
const KINDS: SpecValueKind[] = ["number", "text", "enum", "dimension"];

const EMPTY: SchemaFieldInput = { scope: "common", key: "", label: "", value_kind: "number", unit: "" };

function inputStyle(): React.CSSProperties {
  return { padding: 6, border: "1px solid #dcdde1", fontSize: 13, width: "100%" };
}

export function SchemaEditor({ families }: { families: SchemaFamily[] }) {
  const [familyId, setFamilyId] = useState<string>(families[0]?.id ?? "");
  const [draft, setDraft] = useState<SchemaFieldInput>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<SchemaFieldInput>(EMPTY);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();

  const family = useMemo(() => families.find((f) => f.id === familyId) ?? null, [families, familyId]);

  function run(fn: () => Promise<unknown>, ok: string) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      try {
        await fn();
        setMessage(ok);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      }
    });
  }

  function handleAdd() {
    if (!familyId) return;
    run(async () => {
      await createSchemaField(familyId, draft);
      setDraft(EMPTY);
    }, `Added "${draft.label}".`);
  }

  function startEdit(f: SchemaFieldRow) {
    setEditingId(f.id);
    setEditDraft({
      scope: (f.scope ?? "common") as SpecScope,
      key: f.key,
      label: f.label,
      value_kind: (f.value_kind ?? "number") as SpecValueKind,
      unit: f.unit ?? "",
      sort: f.sort,
    });
    setError(null);
    setMessage(null);
  }

  function handleSaveEdit() {
    if (!editingId) return;
    run(async () => {
      await updateSchemaField(editingId, editDraft);
      setEditingId(null);
    }, `Saved "${editDraft.label}".`);
  }

  function handleDelete(f: SchemaFieldRow) {
    if (f.valueCount > 0) return;
    if (!confirm(`Delete field "${f.label}" (${f.key})? This cannot be undone.`)) return;
    run(async () => {
      await deleteSchemaField(f.id);
    }, `Deleted "${f.label}".`);
  }

  const fieldsTable = (fields: SchemaFieldRow[]) => {
    if (fields.length === 0) return <p className="sx-sub">No fields in this group yet.</p>;
    return (
      <table className="sx-list">
        <thead>
          <tr>
            <th>Label</th>
            <th>Key</th>
            <th>Scope</th>
            <th>Kind</th>
            <th>Unit</th>
            <th className="r">Values</th>
            <th className="r">Actions</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((f) =>
            editingId === f.id ? (
              <tr key={f.id} style={{ background: "var(--sx-lilac, #f6f5f9)" }}>
                <td><input value={editDraft.label} onChange={(e) => setEditDraft((d) => ({ ...d, label: e.target.value }))} style={inputStyle()} /></td>
                <td><input value={editDraft.key} onChange={(e) => setEditDraft((d) => ({ ...d, key: e.target.value }))} style={inputStyle()} /></td>
                <td>
                  <select value={editDraft.scope} onChange={(e) => setEditDraft((d) => ({ ...d, scope: e.target.value as SpecScope }))} style={inputStyle()}>
                    {SCOPES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </td>
                <td>
                  <select value={editDraft.value_kind} onChange={(e) => setEditDraft((d) => ({ ...d, value_kind: e.target.value as SpecValueKind }))} style={inputStyle()}>
                    {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                  </select>
                </td>
                <td><input value={editDraft.unit ?? ""} onChange={(e) => setEditDraft((d) => ({ ...d, unit: e.target.value }))} style={inputStyle()} /></td>
                <td className="r tnum">{f.valueCount}</td>
                <td className="r" style={{ whiteSpace: "nowrap" }}>
                  <button type="button" className="sx-btn sx-btn-go sx-btn-sm" onClick={handleSaveEdit} disabled={pending}>Save</button>{" "}
                  <button type="button" className="sx-btn sx-btn-sm" onClick={() => setEditingId(null)}>Cancel</button>
                </td>
              </tr>
            ) : (
              <tr key={f.id}>
                <td>{f.label}</td>
                <td style={{ fontFamily: "ui-monospace, Menlo, monospace" }}>{f.key}</td>
                <td>{f.scope}</td>
                <td>{f.value_kind}</td>
                <td>{f.unit || "—"}</td>
                <td className="r tnum">{f.valueCount}</td>
                <td className="r" style={{ whiteSpace: "nowrap" }}>
                  <button type="button" className="sx-btn sx-btn-sm" onClick={() => startEdit(f)}>Edit</button>{" "}
                  <button
                    type="button"
                    className="sx-btn sx-btn-sm sx-btn-danger"
                    onClick={() => handleDelete(f)}
                    disabled={pending || f.valueCount > 0}
                    title={f.valueCount > 0 ? `Locked: ${f.valueCount} value(s) reference this field. Clear them via a change request first.` : "Delete this field"}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            )
          )}
        </tbody>
      </table>
    );
  };

  if (families.length === 0) {
    return <p className="sx-sub">No families yet. Import a baseline first, then manage its schema here.</p>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Family picker */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <span className="sx-micro">Family</span>
        <select
          value={familyId}
          onChange={(e) => {
            setFamilyId(e.target.value);
            setEditingId(null);
          }}
          style={{ ...inputStyle(), width: "auto", minWidth: 220 }}
        >
          {families.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name} ({f.fields.length} field{f.fields.length === 1 ? "" : "s"})
            </option>
          ))}
        </select>
      </div>

      {/* Add a field (above the field lists) */}
      <div className="card sec">
        <div className="sx-sectitle">
          <h2>Add a field</h2>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1.2fr 0.9fr 0.9fr 0.8fr auto", gap: 8, alignItems: "end" }}>
          <div>
            <div className="sx-micro">Label</div>
            <input value={draft.label} onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))} style={inputStyle()} placeholder="Battery capacity" />
          </div>
          <div>
            <div className="sx-micro">Key</div>
            <input value={draft.key} onChange={(e) => setDraft((d) => ({ ...d, key: e.target.value }))} style={inputStyle()} placeholder="battery_capacity" />
          </div>
          <div>
            <div className="sx-micro">Scope</div>
            <select value={draft.scope} onChange={(e) => setDraft((d) => ({ ...d, scope: e.target.value as SpecScope }))} style={inputStyle()}>
              {SCOPES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <div className="sx-micro">Kind</div>
            <select value={draft.value_kind} onChange={(e) => setDraft((d) => ({ ...d, value_kind: e.target.value as SpecValueKind }))} style={inputStyle()}>
              {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
          <div>
            <div className="sx-micro">Unit</div>
            <input value={draft.unit ?? ""} onChange={(e) => setDraft((d) => ({ ...d, unit: e.target.value }))} style={inputStyle()} placeholder="Wh" />
          </div>
          <button type="button" className="sx-btn sx-btn-go" onClick={handleAdd} disabled={pending || !draft.key || !draft.label}>
            {pending ? "Saving…" : "Add field"}
          </button>
        </div>
        <p className="sx-micro" style={{ marginTop: 8, color: "var(--sx-text-2, #6b6d76)" }}>
          Key = lowercase letters, numbers, underscores. Common = one value for the whole family; Model = one value per model.
        </p>
      </div>

      {/* Common fields — scope: common */}
      <div className="card sec">
        <div className="sx-sectitle">
          <h2>Common fields — {family?.name}</h2>
          <div className="rhs">
            <span className="sx-micro">Applies to every model</span>
          </div>
        </div>
        {fieldsTable((family?.fields ?? []).filter((f) => (f.scope ?? "common") === "common"))}
      </div>

      {/* Model fields — scope: model */}
      <div className="card sec">
        <div className="sx-sectitle">
          <h2>Model fields — {family?.name}</h2>
          <div className="rhs">
            <span className="sx-micro">Varies by model</span>
          </div>
        </div>
        {fieldsTable((family?.fields ?? []).filter((f) => f.scope === "model"))}
      </div>

      {error ? <span className="sx-micro" style={{ color: "#b91c1c" }}>{error}</span> : null}
      {message ? <span className="sx-micro" style={{ color: "#166534" }}>{message}</span> : null}
    </div>
  );
}
