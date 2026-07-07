"use client";

import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import {
  CUSTOM_OPTION_SENTINEL,
  customValueKey,
  isCustomValueKey,
  resolveFactoryInstruction,
  type ConfigField,
  type FactoryMapping,
} from "@/lib/types";
import { ConfigFieldInput } from "@/components/ProductConfigurator";
import {
  FACTORY_EXTRA_CATEGORIES,
  FACTORY_EXTRA_SUGGESTIONS,
  resolveFactoryExtras,
  slugifyKey,
  type FactoryExtras,
  type ResolvedFactoryExtra,
} from "@/lib/factory-extras";
import {
  updateTaskListLine,
  updateTaskListLineTechnical,
  setLineFieldOverride,
  setLineExtraOverride,
  setClientFieldOverride,
  setClientExtraOverride,
} from "./actions";
import { useDirty } from "./DirtyContext";
import { pushToast } from "@/components/feedback/toast-store";

/**
 * Resolves what a raw stored value should be displayed as in the live
 * summary. Returns null if nothing should be shown for this key.
 */
function displayValueFor(
  fieldName: string,
  values: Record<string, string>
): string | null {
  let raw = values[fieldName];
  if (raw === CUSTOM_OPTION_SENTINEL) {
    raw = values[customValueKey(fieldName)] ?? "";
  }
  if (raw == null || raw === "") return null;
  if (raw === "false") return "No";
  if (raw === "true") return "Yes";
  return raw;
}

function buildSummary(
  fields: ConfigField[],
  values: Record<string, string>
) {
  const rows: Array<{
    label: string;
    value: string;
    internal: boolean;
    missing?: boolean;
  }> = [];
  const seen = new Set<string>();
  for (const f of fields) {
    const display = displayValueFor(f.field_name, values);
    seen.add(f.field_name);
    seen.add(customValueKey(f.field_name));
    if (display === null) {
      if (f.required) {
        rows.push({
          label: f.field_name,
          value: "— not set —",
          internal: f.internal_only,
          missing: true,
        });
      }
      continue;
    }
    rows.push({
      label: f.field_name,
      value: display,
      internal: f.internal_only,
    });
  }
  for (const [k, v] of Object.entries(values)) {
    if (seen.has(k)) continue;
    if (isCustomValueKey(k)) continue;
    if (v == null || v === "") continue;
    let display = v;
    if (v === "true") display = "Yes";
    else if (v === "false") display = "No";
    rows.push({ label: k, value: display, internal: false });
  }
  return rows;
}

/**
 * Factory-instruction save button. Three layers of confirmation so the user is
 * CERTAIN the save reached the server (not just "I clicked something"):
 *   1. idle → spinner "Saving…" (disabled, blocks double-clicks)
 *           → green "✓ Saved" on the button (held ~2.4 s, pop animation)
 *           → back to the normal label.
 *   2. a green success TOAST ("✓ Saved to this order / for this client").
 *   3. a PERSISTENT green badge on the row ("✓ Saved … · HH:MM") that stays
 *      until the field is edited again (see savedRows).
 * On failure: the button restores, an inline error shows, AND a red error toast
 * fires — so a failed save can never look like a success. Module-level so its
 * state survives parent re-renders.
 */
function SaveButton({
  onSave,
  children,
  className = "btn sm",
  title,
  disabled = false,
  successMessage,
}: {
  onSave: () => Promise<void>;
  children: ReactNode;
  className?: string;
  title?: string;
  disabled?: boolean;
  /** Shown in the green success toast (e.g. "✓ Saved to this order"). */
  successMessage?: string;
}) {
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [err, setErr] = useState<string | null>(null);
  async function handle() {
    if (status !== "idle" || disabled) return; // block double-clicks + empty
    setErr(null);
    setStatus("saving");
    try {
      await onSave();
      setStatus("saved");
      pushToast(successMessage ?? "Saved", "success");
      setTimeout(() => setStatus("idle"), 2400);
    } catch (e: any) {
      const msg = e?.message ?? "Save failed — try again.";
      setErr(msg);
      pushToast(msg, "error");
      setStatus("idle");
    }
  }
  return (
    <span className="fi-savewrap">
      <button
        type="button"
        onClick={handle}
        disabled={status !== "idle" || disabled}
        aria-busy={status === "saving"}
        className={`${className} fi-savebtn fi-st-${status}`}
        title={title}
      >
        {status === "saving" ? (
          <>
            <span className="fi-spin" aria-hidden /> Saving…
          </>
        ) : status === "saved" ? (
          <>
            <span className="fi-tick" aria-hidden>
              ✓
            </span>{" "}
            Saved
          </>
        ) : (
          children
        )}
      </button>
      {err && (
        <span className="fi-saveerr" role="alert">
          {err}
        </span>
      )}
    </span>
  );
}

/**
 * Persistent confirmation that a row's value is saved — stays visible (with the
 * exact save time) until the field is edited again, so the user can glance back
 * and be sure the value was committed. Complements the transient button ✓/toast.
 */
function SavedBadge({
  saved,
}: {
  saved: { mode: "order" | "client"; at: number };
}) {
  const time = new Date(saved.at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <span className="fi-saved" role="status">
      <span className="fi-saved-ck" aria-hidden>
        ✓
      </span>
      Saved {saved.mode === "client" ? "for this client" : "to this order"}
      <span className="fi-saved-at"> · {time}</span>
    </span>
  );
}

export default function TaskLineEditor({
  lineId,
  taskListId,
  clientId,
  productId,
  categoryId,
  isManual,
  productName,
  initialName,
  initialSpecs,
  salesSpec,
  unitPrice,
  currency,
  initialQty,
  initialConfig,
  initialTechnical,
  initialFactoryOverrides,
  initialNotes,
  salesFields,
  technicalFields,
  salesEditable,
  technicalEditable,
  mappingByOption,
  optionIdByFieldValue,
  clientOverrides,
  clientExtras,
  initialFactoryExtras,
}: {
  lineId: string;
  taskListId: string;
  clientId: string | null;
  productId: string;
  /** The line's product category — scopes the option lookup to this family. */
  categoryId: string | null;
  /**
   * m135 — manual item (pole/mast/non-catalog): no Product reference. The name
   * + specifications are editable here and the unit price is a read-only
   * reference copied from the quotation. Catalog lines render unchanged.
   */
  isManual: boolean;
  productName: string;
  /** Manual items only — the editable item name/description (→ product_name). */
  initialName: string;
  /** Manual items only — free-text specifications (→ manual_specs). */
  initialSpecs: string | null;
  /** BUG-6 — the captured Service-Request spec ("cahier des charges"), shown
   *  inline above the catalog config so whoever fills it sees exactly what
   *  sales specified, right next to the fields (not just in the page header). */
  salesSpec?: string | null;
  /** Manual items only — read-only reference unit price (quoted), or null. */
  unitPrice: number | null;
  /** Currency code for the reference price display (from the linked quote). */
  currency: string | null;
  initialQty: number;
  initialConfig: Record<string, string>;
  initialTechnical: Record<string, string>;
  initialFactoryOverrides: Record<string, string>;
  initialNotes: string | null;
  salesFields: ConfigField[];
  technicalFields: ConfigField[];
  salesEditable: boolean;
  technicalEditable: boolean;
  /** option_id → FactoryMapping (serialized from a Map on the server). */
  mappingByOption: Record<string, FactoryMapping>;
  /** optionLookupKey(category_id, field_name, value) → option_id. */
  optionIdByFieldValue: Record<string, string>;
  /**
   * This client's saved technical preset (fieldName → factory instruction),
   * resolved between the global mapping and the per-line order override.
   * `null`/empty when no preset exists for this client + product yet.
   */
  clientOverrides: Record<string, string> | null;
  /**
   * Additional factory-only attributes from this client's preset (controller,
   * connectors, cables, packaging, …) — the reusable base for the
   * "Additional factory fields" block, overridden by this order's own list.
   */
  clientExtras: FactoryExtras;
  /** This line's saved order-layer factory extras (overrides + tombstones). */
  initialFactoryExtras: FactoryExtras;
}) {
  const [qty, setQty] = useState(initialQty);
  const [config, setConfig] = useState<Record<string, string>>(
    initialConfig ?? {}
  );
  const [technical, setTechnical] = useState<Record<string, string>>(
    initialTechnical ?? {}
  );
  const [factoryOverrides, setFactoryOverrides] = useState<
    Record<string, string>
  >(initialFactoryOverrides ?? {});
  const [notes, setNotes] = useState(initialNotes ?? "");
  // m135 — manual item: editable name + free-text specifications. Unused for
  // catalog lines (isManual === false), where the name is the static label.
  const [name, setName] = useState(initialName ?? "");
  const [specs, setSpecs] = useState(initialSpecs ?? "");
  // CLIENT layer (field-level deltas) — kept as local optimistic state so a
  // per-field "Save / Remove for client" updates the badges immediately.
  // Seeded from the server props; the server persists each delta.
  const [clientFieldOverrides, setClientFieldOverrides] = useState<
    Record<string, string>
  >(clientOverrides ?? {});
  const [clientExtrasBase, setClientExtrasBase] = useState<FactoryExtras>(
    clientExtras ?? []
  );
  // Additional factory attributes — working list resolved from the client
  // preset (base) + this order's overrides/tombstones. Edits flip a row's
  // source to "order"; the minimal order diff is computed on save.
  const [extras, setExtras] = useState<ResolvedFactoryExtra[]>(() =>
    resolveFactoryExtras(clientExtras ?? [], initialFactoryExtras ?? [])
  );
  const [addingExtra, setAddingExtra] = useState(false);
  const [extraType, setExtraType] = useState(""); // suggestion key | "__custom__"
  const [extraCustomLabel, setExtraCustomLabel] = useState("");
  const [extraNewValue, setExtraNewValue] = useState("");
  // Per-row "just saved" confirmation: rowKey → which layer it landed in.
  // Sales rows key on field_name; extras key on `extra:${key}`. Cleared when
  // the row is edited again so the chip never lies about unsaved changes.
  const [savedRows, setSavedRows] = useState<
    Record<string, { mode: "order" | "client"; at: number }>
  >({});
  const [pendingSales, startSales] = useTransition();
  const [pendingTech, startTech] = useTransition();
  const [pendingFactory, startFactory] = useTransition();
  const [pendingPreset, startPreset] = useTransition();
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [savedTechAt, setSavedTechAt] = useState<number | null>(null);
  // Dirty tracking — set to true whenever the user edits, false after save.
  const [isDirty, setIsDirty] = useState(false);
  const [isTechDirty, setIsTechDirty] = useState(false);
  const dirty = useDirty();

  // Register / unregister with the page-level dirty context.
  useEffect(() => {
    dirty.registerSaveFn(lineId, async () => {
      // saveSales equivalent — wrapped as an async promise.
      if (!isDirty) return;
      const fd = new FormData();
      fd.set("id", lineId);
      fd.set("task_list_id", taskListId);
      fd.set("quantity", String(qty));
      fd.set("config_values", JSON.stringify(config));
      if (notes) fd.set("internal_notes", notes);
      if (isManual) {
        // Manual item: persist the editable name + specs (product_name +
        // manual_specs). unit_price stays server-side read-only.
        fd.set("is_manual", "1");
        fd.set("product_name", name);
        fd.set("manual_specs", specs);
      }
      await updateTaskListLine(fd);
      setSavedAt(Date.now());
      setIsDirty(false);
      dirty.setDirty(lineId, false);
    });
    return () => dirty.unregisterSaveFn(lineId);
    // Intentionally wide deps — save fn captures latest state values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineId, taskListId, qty, config, notes, isManual, name, specs, isDirty]);

  // Push dirty state to context whenever it changes.
  useEffect(() => {
    dirty.setDirty(lineId, isDirty || isTechDirty);
    return () => dirty.setDirty(lineId, false); // cleanup on unmount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDirty, isTechDirty, lineId]);

  function markRowSaved(rowKey: string, mode: "order" | "client") {
    setSavedRows((prev) => ({ ...prev, [rowKey]: { mode, at: Date.now() } }));
  }
  function clearRowSaved(rowKey: string) {
    setSavedRows((prev) => {
      if (!(rowKey in prev)) return prev;
      const next = { ...prev };
      delete next[rowKey];
      return next;
    });
  }

  function setExtraValue(key: string, label: string, val: string) {
    clearRowSaved(`extra:${key}`);
    setExtras((prev) => {
      const i = prev.findIndex((e) => e.key === key);
      if (i === -1)
        return [...prev, { key, label, value: val, source: "order" as const }];
      const copy = [...prev];
      copy[i] = { ...copy[i], label, value: val, source: "order" };
      return copy;
    });
  }
  function addExtra() {
    const v = extraNewValue.trim();
    if (!v || !extraType) return;
    let key: string;
    let label: string;
    if (extraType === "__custom__") {
      label = extraCustomLabel.trim();
      if (!label) return;
      key = slugifyKey(label);
    } else {
      key = extraType;
      let found: { key: string; label: string } | undefined;
      for (const cat of FACTORY_EXTRA_CATEGORIES) {
        found = FACTORY_EXTRA_SUGGESTIONS[cat].find((s) => s.key === extraType);
        if (found) break;
      }
      label = found?.label ?? extraType;
    }
    setExtraValue(key, label, v);
    setAddingExtra(false);
    setExtraType("");
    setExtraCustomLabel("");
    setExtraNewValue("");
  }

  function saveSales() {
    const fd = new FormData();
    fd.set("id", lineId);
    fd.set("task_list_id", taskListId);
    fd.set("quantity", String(qty));
    fd.set("config_values", JSON.stringify(config));
    if (notes) fd.set("internal_notes", notes);
    if (isManual) {
      fd.set("is_manual", "1");
      fd.set("product_name", name);
      fd.set("manual_specs", specs);
    }
    startSales(async () => {
      try {
        await updateTaskListLine(fd);
        setSavedAt(Date.now());
        setIsDirty(false);
        pushToast("Line saved", "success");
      } catch (e: any) {
        pushToast(e?.message ?? "Could not save the line — try again.", "error");
      }
    });
  }

  function saveTechnical() {
    const fd = new FormData();
    fd.set("id", lineId);
    fd.set("task_list_id", taskListId);
    fd.set("technical_values", JSON.stringify(technical));
    startTech(async () => {
      try {
        await updateTaskListLineTechnical(fd);
        setSavedTechAt(Date.now());
        setIsTechDirty(false);
        pushToast("Technical edits saved", "success");
      } catch (e: any) {
        pushToast(e?.message ?? "Could not save technical edits — try again.", "error");
      }
    });
  }

  /* =====================================================================
     FIELD-LEVEL persistence. Each factory row decides independently:
       inherit global default · override for this ORDER · override for CLIENT.
     Two explicit, local save modes per row + revert. No global bottom save.
     ===================================================================== */

  // ---- Sales-derived factory rows (resolved per sales dropdown) ----

  /** Live edit of a row's instruction text → local ORDER buffer. */
  function editFieldText(fieldName: string, value: string) {
    clearRowSaved(fieldName);
    setFactoryOverride(fieldName, value);
  }

  /** [Order only] — persist this field's value as an order override (this
   *  line only). Does NOT touch the client preset. */
  async function saveFieldForOrder(fieldName: string, value: string) {
    const text = value.trim();
    if (!text) return;
    setFactoryOverride(fieldName, text);
    const fd = new FormData();
    fd.set("id", lineId);
    fd.set("field_name", fieldName);
    fd.set("text", text);
    fd.set("task_list_id", taskListId);
    // Awaited directly (not via a transition) so the SaveButton can show its
    // own saving → saved → idle feedback and surface errors.
    await setLineFieldOverride(fd);
    markRowSaved(fieldName, "order");
  }

  /** [Save for client] — promote ONE field to the client preset (delta) and
   *  clear its order override so the row resolves as "Client preset". Other
   *  fields keep inheriting the global default. */
  async function saveFieldForClient(fieldName: string, value: string) {
    if (!clientId || !productId || !value.trim()) return;
    const text = value.trim();
    setClientFieldOverrides((prev) => ({ ...prev, [fieldName]: text }));
    setFactoryOverrides((prev) => {
      const next = { ...prev };
      delete next[fieldName];
      return next;
    });
    const fd = new FormData();
    fd.set("client_id", clientId);
    fd.set("product_id", productId);
    fd.set("field_name", fieldName);
    fd.set("text", text);
    fd.set("line_id", lineId);
    fd.set("task_list_id", taskListId);
    await setClientFieldOverride(fd);
    markRowSaved(fieldName, "client");
  }

  /** Discard this order's edit → fall back to client preset / global mapping
   *  (persists the cleared order override). */
  function clearFieldOrder(fieldName: string) {
    setFactoryOverride(fieldName, "");
    clearRowSaved(fieldName);
    const fd = new FormData();
    fd.set("id", lineId);
    fd.set("field_name", fieldName);
    fd.set("text", "");
    fd.set("task_list_id", taskListId);
    startFactory(async () => {
      await setLineFieldOverride(fd);
    });
  }

  /** Remove ONE field's client override → reverts to the global default for
   *  this and every future order. */
  function removeFieldForClient(fieldName: string) {
    if (!clientId || !productId) return;
    setClientFieldOverrides((prev) => {
      const next = { ...prev };
      delete next[fieldName];
      return next;
    });
    clearRowSaved(fieldName);
    const fd = new FormData();
    fd.set("client_id", clientId);
    fd.set("product_id", productId);
    fd.set("field_name", fieldName);
    fd.set("text", "");
    fd.set("task_list_id", taskListId);
    startPreset(async () => {
      await setClientFieldOverride(fd);
    });
  }

  // ---- Additional factory attribute rows ----

  /** [Order only] — persist ONE additional attribute to this line's order
   *  layer. */
  async function saveExtraForOrder(ex: ResolvedFactoryExtra) {
    if (!ex.value.trim()) return;
    setExtras((prev) =>
      prev.map((e) => (e.key === ex.key ? { ...e, source: "order" } : e))
    );
    const fd = new FormData();
    fd.set("id", lineId);
    fd.set("key", ex.key);
    fd.set("label", ex.label);
    fd.set("value", ex.value);
    fd.set("task_list_id", taskListId);
    await setLineExtraOverride(fd);
    markRowSaved(`extra:${ex.key}`, "order");
  }

  /** [Save for client] — promote ONE additional attribute to the client
   *  preset (delta) and clear it from this line's order layer. */
  async function saveExtraForClient(ex: ResolvedFactoryExtra) {
    if (!clientId || !productId || !ex.value.trim()) return;
    setClientExtrasBase((prev) => {
      const without = prev.filter((e) => e.key !== ex.key);
      return [...without, { key: ex.key, label: ex.label, value: ex.value }];
    });
    setExtras((prev) =>
      prev.map((e) => (e.key === ex.key ? { ...e, source: "client" } : e))
    );
    const fd = new FormData();
    fd.set("client_id", clientId);
    fd.set("product_id", productId);
    fd.set("key", ex.key);
    fd.set("label", ex.label);
    fd.set("value", ex.value);
    fd.set("line_id", lineId);
    fd.set("task_list_id", taskListId);
    await setClientExtraOverride(fd);
    markRowSaved(`extra:${ex.key}`, "client");
  }

  /** Remove ONE additional attribute's client override (stays on this order
   *  as an order-specific value until saved/removed). */
  function removeExtraForClient(ex: ResolvedFactoryExtra) {
    if (!clientId || !productId) return;
    setClientExtrasBase((prev) => prev.filter((e) => e.key !== ex.key));
    setExtras((prev) =>
      prev.map((e) => (e.key === ex.key ? { ...e, source: "order" } : e))
    );
    clearRowSaved(`extra:${ex.key}`);
    const fd = new FormData();
    fd.set("client_id", clientId);
    fd.set("product_id", productId);
    fd.set("key", ex.key);
    fd.set("value", "");
    fd.set("task_list_id", taskListId);
    startPreset(async () => {
      await setClientExtraOverride(fd);
    });
  }

  /** ✕ — remove an additional attribute from THIS order. If it was inherited
   *  from the client preset, persist a tombstone so it stays hidden here;
   *  otherwise drop it from the line's order layer. */
  function removeExtraFromOrder(ex: ResolvedFactoryExtra) {
    const inheritedFromClient = clientExtrasBase.some((e) => e.key === ex.key);
    setExtras((prev) => prev.filter((e) => e.key !== ex.key));
    clearRowSaved(`extra:${ex.key}`);
    const fd = new FormData();
    fd.set("id", lineId);
    fd.set("key", ex.key);
    fd.set("label", ex.label);
    fd.set("value", "");
    if (inheritedFromClient) fd.set("tombstone", "1");
    fd.set("task_list_id", taskListId);
    startFactory(async () => {
      await setLineExtraOverride(fd);
    });
  }

  // Rebuild the rebound Map<...> once per render — the server passed plain
  // objects but the resolver expects Maps.
  const mappingMap = useMemo(() => {
    const m = new Map<string, FactoryMapping>();
    for (const [k, v] of Object.entries(mappingByOption)) m.set(k, v);
    return m;
  }, [mappingByOption]);
  const optionIdByValueMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const [k, v] of Object.entries(optionIdByFieldValue)) m.set(k, v);
    return m;
  }, [optionIdByFieldValue]);

  // Resolve a factory instruction for every sales-side dropdown that has a
  // value set. Skips text/number/yes-no fields (no discrete option to map).
  const factoryRows = useMemo(() => {
    return salesFields
      .filter((f) => f.field_type === "dropdown")
      .map((f) => {
        const display = displayValueFor(f.field_name, config);
        if (!display) return null;
        return resolveFactoryInstruction({
          categoryId,
          fieldName: f.field_name,
          salesValue: display,
          overrides: factoryOverrides,
          clientOverrides: clientFieldOverrides,
          mappingsByOption: mappingMap,
          optionIdByFieldValue: optionIdByValueMap,
        });
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
  }, [
    categoryId,
    salesFields,
    config,
    factoryOverrides,
    clientFieldOverrides,
    mappingMap,
    optionIdByValueMap,
  ]);

  function setFactoryOverride(fieldName: string, value: string) {
    setFactoryOverrides((prev) => {
      const next = { ...prev };
      if (value.trim() === "") delete next[fieldName];
      else next[fieldName] = value;
      return next;
    });
  }

  const salesSummary = useMemo(
    () => buildSummary(salesFields, config),
    [salesFields, config]
  );
  const techSummary = useMemo(
    () => buildSummary(technicalFields, technical),
    [technicalFields, technical]
  );

  // Battery Cell Type (production-only) — the manufacturing cell technology the
  // TLM selects from Factory Mapping. Stored in technical_values so it stays
  // INVISIBLE to sales, saves with the task list, and auto-appears on the
  // factory PDF (technical refs — via exportData's raw-key fallback). Shown
  // only for battery-bearing catalogue products (not manual items).
  const BATTERY_CELL_KEY = "Battery Cell Type";
  const BATTERY_CELL_OPTIONS = ["32700", "26650", "18650", "G2W"];
  // Gate on `technicalEditable` (= technical role: TLM / operations / admin) so
  // the field is strictly INVISIBLE to sales — not merely read-only. Only for
  // battery-bearing catalogue lines.
  const showBatteryCell =
    technicalEditable &&
    !isManual &&
    salesFields.some((f) => /batter/i.test(f.field_name));

  return (
    <div className="panel p-4 space-y-5">
      {/* Header: line + quantity (mockup .cfg-line) */}
      <div className="cfg-line">
        {isManual ? (
          /* m135 — manual item: the name IS editable (no catalog product). */
          <div className="min-w-0 flex-1">
            <div className="lk flex items-center gap-2">
              <span>Manual item</span>
              <span
                className="inline-flex items-center rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700"
                title="Non-catalog line (e.g. pole/mast). Edit it freely — no Product reference required."
              >
                Manual
              </span>
            </div>
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setIsDirty(true);
              }}
              disabled={!salesEditable}
              placeholder="Item name / description — e.g. Pole 8m, hot-dip galvanized, arm 1.5m"
              aria-label="Item name"
              className="mt-1 w-full rounded-md border border-neutral-200 px-3 py-1.5 text-sm font-medium disabled:bg-neutral-50"
            />
          </div>
        ) : (
          <div>
            <div className="lk">Line</div>
            <div className="lv">{productName}</div>
          </div>
        )}
        <div className="qwrap">
          <div className="lk">Quantity</div>
          {/* Dirty / Saved status for this line */}
          {salesEditable && (isDirty || isTechDirty) && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />
              Unsaved changes
            </span>
          )}
          {salesEditable && !isDirty && !isTechDirty && savedAt && (
            <span className="text-[11px] font-medium text-emerald-700">
              ✓ Saved · {new Date(savedAt).toLocaleTimeString()}
            </span>
          )}
          <label className="qbox block">
            <input
              type="number"
              min={0}
              value={qty}
              onChange={(e) => {
                setQty(parseInt(e.target.value) || 0);
                setIsDirty(true);
              }}
              disabled={!salesEditable}
              aria-label="Quantity"
            />
          </label>
        </div>
      </div>

      {/* ---------- MANUAL ITEM (pole/mast/non-catalog) ----------
          m135. No catalog Product → free-text specifications + a read-only
          reference price copied from the quotation. Replaces the catalog
          configurator (there is no category to drive fields/mappings). */}
      {isManual && (
        <section className="rounded-lg border border-violet-200 bg-violet-50/40 p-4 space-y-3">
          <div>
            <div className="eyebrow text-violet-900">Specifications</div>
            <p className="text-[11px] text-neutral-500 mt-0.5">
              Free-text specs for this manual item — height, thickness, arm,
              wind load, galvanization, etc. Shown to the production team and on
              the factory export.
            </p>
          </div>
          <textarea
            value={specs}
            onChange={(e) => {
              setSpecs(e.target.value);
              setIsDirty(true);
            }}
            disabled={!salesEditable}
            placeholder={
              "e.g.\nHeight: 8 m\nThickness: 4 mm\nArm: 1.5 m\nWind load: 150 km/h\nGalvanization: hot-dip"
            }
            rows={5}
            className="w-full rounded-md border border-neutral-200 px-3 py-2 text-sm disabled:bg-neutral-50"
          />
          {unitPrice != null && (
            <div className="flex items-center justify-between rounded-md border border-neutral-200 bg-white px-3 py-2">
              <span className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">
                Quoted unit price <span className="normal-case">(reference)</span>
              </span>
              <span className="text-sm font-semibold tabular-nums text-neutral-800">
                {currency ? `${currency} ` : ""}
                {unitPrice.toLocaleString(undefined, {
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 2,
                })}
              </span>
            </div>
          )}
        </section>
      )}

      {/* ---------- SALES SECTION ---------- */}
      {salesFields.length > 0 && (
        <section>
          {!salesEditable && (
            <div className="flex items-center justify-end mb-2">
              <span
                className="tag-warn"
                title="This task list has been submitted for production validation. Sales fields are locked until the production team bounces it back to needs_revision."
              >
                <span className="haz" aria-hidden />
                <span className="tw-txt">Locked — submitted for validation</span>
              </span>
            </div>
          )}

          {/* Explicit locked banner. Replaces the previous subtle "Locked"
              pill — sales users repeatedly mistook the pointer-events-none
              dropdowns for a bug rather than an intentional lock. */}
          {!salesEditable && (
            <div className="rounded-md border border-amber-200 bg-amber-50/70 px-3 py-2 text-[11px] text-amber-900 leading-relaxed mb-3">
              <b>Read-only.</b> Sales fields are locked while the task list
              is in production validation. To make changes, ask the
              production team to send it back for revision (the
              &quot;Needs revision&quot; action).
            </div>
          )}

          <div className="cfg-wrap">
            <fieldset
              disabled={!salesEditable}
              className="cfg-form min-w-0 disabled:opacity-60"
            >
              <div className="micro">Sales configuration</div>
              <div className="hint">What the sales team specified.</div>
              {/* BUG-6 — surface the service-request spec right at the config so
                  the catalog options are matched deliberately to what sales
                  sold (the fields start empty because the SR captures free-text,
                  not catalog enums — auto-guessing would risk a wrong build). */}
              {!isManual && salesSpec?.trim() && (
                <div
                  className="mb-3 rounded-md border border-sky-200 bg-sky-50/70 px-3 py-2 text-[12px] leading-relaxed text-sky-900"
                  style={{ whiteSpace: "pre-line" }}
                >
                  <b>From the service request — match these specs:</b>
                  {"\n"}
                  {salesSpec}
                </div>
              )}
              {salesFields.map((f) => (
                <ConfigFieldInput
                  key={f.id}
                  field={f}
                  values={config}
                  onChange={(patch) => {
                    setConfig((prev) => ({ ...prev, ...patch }));
                    setIsDirty(true);
                  }}
                />
              ))}
            </fieldset>
            <aside>
              <SummaryPanel rows={salesSummary} tone="sales" />
            </aside>
          </div>
        </section>
      )}

      {/* ---------- FACTORY INSTRUCTIONS ----------
          Two parts: (1) instructions resolved per sales dropdown
          (global mapping → client preset → this order), and (2) additional
          factory-only attributes that don't exist in the sales config.
          Skipped for manual items (no category → no mappings; m135). */}
      {technicalEditable && !isManual && (
        <section className="space-y-3">
          <div className="sec-head">
            <div className="lhs">
              <h2>Factory instructions</h2>
              <div className="lead">
                Resolved in layers:{" "}
                <Link href="/factory-mapping" className="lk">
                  global mapping
                </Link>{" "}
                → client override → this order. Edit any row, then save it{" "}
                <b>Order only</b> (one-off) or <b>for client</b> (pin just that
                field — every future order for this client inherits it, while
                all other fields keep following the global default).
              </div>
            </div>
            {factoryRows.some((r) => r.source === "missing") && (
              <div className="rhs">
                <span className="tag-warn">
                  <span className="flag" aria-hidden>
                    <HazardFlag />
                  </span>
                  <span className="tw-txt">
                    {factoryRows.filter((r) => r.source === "missing").length}{" "}
                    missing mapping
                    {factoryRows.filter((r) => r.source === "missing").length ===
                    1
                      ? ""
                      : "s"}
                  </span>
                </span>
              </div>
            )}
          </div>
          {factoryRows.length === 0 && (
            <p className="text-[11px] text-neutral-400">
              No sales-driven factory fields on this line. Add factory-only
              references below.
            </p>
          )}
          <div className="fi-grid">
            {factoryRows.map((row) => (
              <div key={row.field_name} className="fi-card">
                <div className="fi-top">
                  <span className="fi-name">
                    {row.field_name} <span className="kk">= {row.sales_value}</span>
                    {row.factory_code && (
                      <span className="fi-code">{row.factory_code}</span>
                    )}
                    {row.source === "override" && (
                      <span className="fi-src order">This order</span>
                    )}
                    {row.source === "client_preset" && (
                      <span
                        className="fi-src client"
                        title="Coming from this client's saved technical preset."
                      >
                        Client preset
                      </span>
                    )}
                    {row.source === "mapping" && (
                      <span
                        className="fi-src"
                        title="Global factory default for this option."
                      >
                        Default
                      </span>
                    )}
                    {savedRows[row.field_name] && (
                      <SavedBadge saved={savedRows[row.field_name]!} />
                    )}
                  </span>
                  {row.source === "missing" && (
                    <span className="tag-warn">
                      <span className="flag" aria-hidden>
                        <HazardFlag />
                      </span>
                      <span className="tw-txt">Missing factory mapping</span>
                    </span>
                  )}
                </div>

                {row.source === "missing" ? (
                  <div className="fi-help">
                    No mapping configured for{" "}
                    <b>
                      {row.field_name} = {row.sales_value}
                    </b>
                    .{" "}
                    <Link href="/factory-mapping" className="lk">
                      Configure it →
                    </Link>{" "}
                    or type a one-off instruction below:
                  </div>
                ) : null}

                <textarea
                  value={
                    factoryOverrides[row.field_name] ??
                    (row.source === "missing" ? "" : row.text)
                  }
                  onChange={(e) =>
                    editFieldText(row.field_name, e.target.value)
                  }
                  rows={row.source === "missing" ? 2 : 3}
                  placeholder={
                    row.source === "missing"
                      ? "Type the factory instruction, then choose where to save it."
                      : "Edit, then save for this order or for the client."
                  }
                />

                {/* Field-local save modes. Shown whenever the row carries a
                    concrete value — including an inherited Default / Client
                    preset value — so the TLM can always pin it for this order
                    or for the client, or edit then save. */}
                {(() => {
                  const effective =
                    factoryOverrides[row.field_name] ??
                    (row.source === "missing" ? "" : row.text);
                  if (!effective.trim()) return null;
                  return (
                    <div className="fi-save">
                      <SaveButton
                        onSave={() => saveFieldForOrder(row.field_name, effective)}
                        className="btn sm primary"
                        successMessage="Saved to this order"
                        title="Save this value for THIS order only — does not change the client preset or global mapping."
                      >
                        Save · Order only
                      </SaveButton>
                      {clientId && (
                        <SaveButton
                          onSave={() => saveFieldForClient(row.field_name, effective)}
                          className="btn sm"
                          successMessage="Saved for this client"
                          title="Save just this field as a client override — auto-loads on every future order for this client. All other fields keep following the global default."
                        >
                          Save · For client
                        </SaveButton>
                      )}
                      {row.source === "override" && (
                        <button
                          type="button"
                          onClick={() => clearFieldOrder(row.field_name)}
                          disabled={pendingFactory}
                          className="text-[11px] text-neutral-500 hover:text-neutral-900 hover:underline disabled:opacity-50"
                          title="Discard this order's edit — fall back to the client preset or global mapping."
                        >
                          Clear
                        </button>
                      )}
                      {row.source === "client_preset" && clientId && (
                        <button
                          type="button"
                          onClick={() => removeFieldForClient(row.field_name)}
                          disabled={pendingPreset}
                          className="text-[11px] font-medium text-rose-600 hover:text-rose-800 hover:underline disabled:opacity-50"
                          title="Remove this client override — the field reverts to the global default for this and every future order."
                        >
                          Remove client override
                        </button>
                      )}
                    </div>
                  );
                })()}
              </div>
            ))}
          </div>

          {/* ---- Additional factory attributes (factory-only, not in sales config) ---- */}
          <div className="space-y-2">
            <div className="fi-foot" style={{ borderTop: "none", paddingTop: 0 }}>
              <div className="micro">Additional factory fields</div>
              <p className="mt-1">
                Factory-only references that aren&apos;t part of the sales
                configuration — controller, connectors, cables, drivers,
                mounting, packaging, inspection, internal refs…
              </p>
            </div>

            {extras.length > 0 ? (
              <ul className="fi-grid">
                {extras.map((ex) => (
                  <li key={ex.key} className="fi-card span2">
                    <div className="fi-top">
                      <span className="fi-name">
                        {ex.label}
                        {ex.source === "client" ? (
                          <span
                            className="fi-src client"
                            title="Coming from this client's saved preset."
                          >
                            Client preset
                          </span>
                        ) : (
                          <span className="fi-src order">This order</span>
                        )}
                        {savedRows[`extra:${ex.key}`] && (
                          <SavedBadge saved={savedRows[`extra:${ex.key}`]!} />
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeExtraFromOrder(ex)}
                        disabled={pendingFactory}
                        className="shrink-0 text-neutral-300 hover:text-rose-600 text-sm leading-none disabled:opacity-50"
                        aria-label={`Remove ${ex.label} from this order`}
                        title="Remove from this order"
                      >
                        ✕
                      </button>
                    </div>
                    <textarea
                      value={ex.value}
                      onChange={(e) =>
                        setExtraValue(ex.key, ex.label, e.target.value)
                      }
                      rows={2}
                      placeholder="Value / instruction — e.g. SR-CTRL-D4I-A12"
                    />
                    {/* Field-local save modes, same as the sales rows. */}
                    <div className="fi-save">
                      <SaveButton
                        onSave={() => saveExtraForOrder(ex)}
                        disabled={!ex.value.trim()}
                        className="btn sm primary"
                        successMessage="Saved to this order"
                        title="Save this field for THIS order only."
                      >
                        Save · Order only
                      </SaveButton>
                      {clientId && (
                        <SaveButton
                          onSave={() => saveExtraForClient(ex)}
                          disabled={!ex.value.trim()}
                          className="btn sm"
                          successMessage="Saved for this client"
                          title="Save just this field as a client override — auto-loads on every future order for this client."
                        >
                          Save · For client
                        </SaveButton>
                      )}
                      {clientId && ex.source === "client" && (
                        <button
                          type="button"
                          onClick={() => removeExtraForClient(ex)}
                          disabled={pendingPreset}
                          className="text-[11px] font-medium text-rose-600 hover:text-rose-800 hover:underline disabled:opacity-50"
                          title="Remove this client override — it won't auto-load on future orders (stays on this order until you remove it)."
                        >
                          Remove client override
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[11px] text-neutral-400">
                No additional factory fields yet.
              </p>
            )}

            {/* Add-flow: choose a suggested field (or custom) → value → chip. */}
            {addingExtra ? (
              <div className="fi-extra-row space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={extraType}
                    onChange={(e) => setExtraType(e.target.value)}
                    className="rounded-md border border-neutral-200 px-2 py-1 text-sm bg-white"
                    style={{ width: "auto", maxWidth: 280 }}
                  >
                    <option value="">Choose a factory field…</option>
                    {FACTORY_EXTRA_CATEGORIES.map((cat) =>
                      FACTORY_EXTRA_SUGGESTIONS[cat].length > 0 ? (
                        <optgroup key={cat} label={cat}>
                          {FACTORY_EXTRA_SUGGESTIONS[cat].map((s) => (
                            <option key={s.key} value={s.key}>
                              {s.label}
                            </option>
                          ))}
                        </optgroup>
                      ) : null
                    )}
                    <option value="__custom__">Custom field…</option>
                  </select>
                  {extraType === "__custom__" && (
                    <input
                      value={extraCustomLabel}
                      onChange={(e) => setExtraCustomLabel(e.target.value)}
                      placeholder="Field name"
                      className="rounded-md border border-neutral-200 px-2 py-1 text-sm"
                      style={{ width: 176 }}
                    />
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    value={extraNewValue}
                    onChange={(e) => setExtraNewValue(e.target.value)}
                    placeholder="Value / instruction"
                    className="flex-1 rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addExtra();
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={addExtra}
                    disabled={
                      !extraNewValue.trim() ||
                      !extraType ||
                      (extraType === "__custom__" && !extraCustomLabel.trim())
                    }
                    className="btn sm primary"
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAddingExtra(false);
                      setExtraType("");
                      setExtraCustomLabel("");
                      setExtraNewValue("");
                    }}
                    className="text-[11px] text-neutral-400 hover:text-neutral-700"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setAddingExtra(true)}
                className="fi-add"
              >
                + Add factory field
              </button>
            )}
          </div>

          <p className="fi-foot">
            Each field saves on its own — <b>Order only</b> (this order) or{" "}
            <b>Save for client</b> (reusable). Client overrides stay small,
            field-level deltas; everything you don&apos;t override keeps
            following the global mapping.
          </p>
        </section>
      )}

      {/* ---------- TECHNICAL SECTION (TLM-curated fields) ---------- */}
      {(technicalFields.length > 0 || showBatteryCell) && (
        <section className="rounded-lg border border-amber-300 bg-amber-50/40 p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="eyebrow text-amber-900">
                Technical references
              </div>
              <p className="text-[11px] text-neutral-500 mt-0.5">
                Internal fields added by the task list manager — never visible
                to the customer.
              </p>
            </div>
            {!technicalEditable && (
              <span className="text-[10px] text-amber-800 font-semibold uppercase tracking-widerx">
                Read-only
              </span>
            )}
          </div>
          <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
            <div
              className={`space-y-3 min-w-0 ${
                technicalEditable ? "" : "opacity-60 pointer-events-none"
              }`}
            >
              {/* Battery Cell Type — production-only manufacturing spec chosen
                  from Factory Mapping. Sits with the battery configuration,
                  hidden from sales, saved on the task list + printed on the
                  factory documents. */}
              {showBatteryCell && (
                <div>
                  <label
                    htmlFor={`batt-cell-${lineId}`}
                    className="block text-[11px] font-semibold uppercase tracking-widerx text-neutral-600 mb-1"
                  >
                    Battery Cell Type
                  </label>
                  <select
                    id={`batt-cell-${lineId}`}
                    value={technical[BATTERY_CELL_KEY] ?? ""}
                    disabled={!technicalEditable}
                    onChange={(e) => {
                      const v = e.target.value;
                      setTechnical((prev) => ({ ...prev, [BATTERY_CELL_KEY]: v }));
                      setIsTechDirty(true);
                    }}
                    className="w-full max-w-[240px] rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm disabled:bg-neutral-50"
                  >
                    <option value="">— select —</option>
                    {BATTERY_CELL_OPTIONS.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                  <p className="text-[10px] text-neutral-500 mt-1">
                    Manufacturing cell technology — saved with the task list and
                    printed on the factory documents. Not visible to sales.
                  </p>
                </div>
              )}
              {technicalFields.map((f) => (
                <ConfigFieldInput
                  key={f.id}
                  field={f}
                  values={technical}
                  onChange={(patch) => {
                    setTechnical((prev) => ({ ...prev, ...patch }));
                    setIsTechDirty(true);
                  }}
                />
              ))}
            </div>
            <aside>
              <SummaryPanel rows={techSummary} tone="technical" />
            </aside>
          </div>
          {technicalEditable && (
            <div className="flex items-center justify-between border-t border-amber-200 pt-3">
              <span className="text-[11px] text-neutral-500">
                {savedTechAt
                  ? `Technical saved · ${new Date(
                      savedTechAt
                    ).toLocaleTimeString()}`
                  : "Save technical edits separately."}
              </span>
              <button
                onClick={saveTechnical}
                disabled={pendingTech}
                className="btn-primary"
              >
                {pendingTech ? "Saving…" : "Save technical"}
              </button>
            </div>
          )}
        </section>
      )}

      {/* ---------- INTERNAL NOTES + SALES SAVE ---------- */}
      <div>
        <div className="eyebrow mb-1">
          Internal notes
          <span className="ml-1 text-[10px] text-sky-700 normal-case tracking-normal font-medium">
            (sales)
          </span>
        </div>
        <textarea
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            setIsDirty(true);
          }}
          placeholder="Manufacturing instructions, special requirements, etc."
          disabled={!salesEditable}
          rows={2}
          className="w-full rounded-md border border-neutral-200 px-3 py-1.5 text-sm disabled:bg-neutral-50"
        />
      </div>

      <div className="flex items-center justify-between">
        <span className="text-[11px] text-neutral-500">
          {isDirty ? (
            <span className="font-medium text-amber-700">
              ● Unsaved changes — click Save line to persist.
            </span>
          ) : savedAt ? (
            <span className="text-emerald-700">
              ✓ Saved · {new Date(savedAt).toLocaleTimeString()}
            </span>
          ) : (
            "Changes are kept in memory until you click Save line."
          )}
        </span>
        {salesEditable && (
          <button
            onClick={saveSales}
            disabled={pendingSales}
            className={`btn-primary transition-colors ${
              isDirty ? "ring-2 ring-amber-400 ring-offset-1" : ""
            }`}
          >
            {pendingSales ? "Saving…" : "Save line"}
          </button>
        )}
      </div>
    </div>
  );
}

function SummaryPanel({
  rows,
  tone,
}: {
  rows: Array<{
    label: string;
    value: string;
    internal: boolean;
    missing?: boolean;
  }>;
  tone: "sales" | "technical";
}) {
  return (
    <div className="summary">
      <div className="micro">
        {tone === "sales" ? "Sales summary" : "Technical summary"}
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-neutral-500">No values yet.</p>
      ) : (
        rows.map((row, i) => (
          <div key={i} className="srow">
            <span className="sk">
              {row.label}
              {row.internal && <span className="int">INT</span>}
            </span>
            <span className={`sv${row.missing ? " missing" : ""}`}>
              {row.value}
            </span>
          </div>
        ))
      )}
    </div>
  );
}

/** Hazard flag glyph used inside the amber "Missing factory mapping" pill —
 *  matches the mockup's animated `.flag` waving square. Purely decorative. */
function HazardFlag() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
      <line x1="4" y1="22" x2="4" y2="15" />
    </svg>
  );
}
