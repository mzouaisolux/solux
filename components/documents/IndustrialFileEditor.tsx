"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  updateIndustrialFile,
  setPoleDrawingTiltVerified,
} from "@/app/(app)/task-lists/[id]/actions";
import { aiFindTiltAction } from "@/app/(app)/lighting/actions";
import { InlineLogoUpload } from "@/components/attachments/InlineLogoUpload";
import {
  TILT_ANGLE_PRESETS,
  PACKAGING_VERSIONS,
  USER_MANUAL_BRANDS,
  MANUAL_LANGUAGES,
  normalizeIndustrialSpec,
  cleanTiltAngle,
  type IndustrialSpec,
  type SparePartRow,
} from "@/lib/industrial-spec";
import {
  itemsForFamily,
  groupItemsByType,
  factoryFillFromItem,
  type DictionaryItem,
  type OrderedFamily,
} from "@/lib/industrial-dictionary";

/**
 * IndustrialFileEditor (m159/m160) — the "Industrial production file" of a
 * task list: solar-panel tilt angle (+ AI Find from the Energy Study + the
 * pole-drawing checkpoint), pole accessories, packaging version, user
 * manuals and PRODUCT-AWARE free spare parts driven by the Product
 * Dictionary (component_mappings): the selector only offers items
 * compatible with the ordered families and auto-fills the official factory
 * terminology (reference + Chinese + ERP code) — everything overridable.
 * One Save persists the whole file; the TLM checkpoint saves on toggle.
 */
export function IndustrialFileEditor({
  taskListId,
  documentId,
  initialTilt,
  tiltVerified,
  tiltVerifiedAt,
  initialSpec,
  editable,
  canVerify,
  families,
  dictionary,
}: {
  taskListId: string;
  /** Proforma id of the command — anchors inline logo/artwork uploads. */
  documentId?: string | null;
  initialTilt: number | null;
  tiltVerified: boolean;
  tiltVerifiedAt: string | null;
  initialSpec: unknown;
  /** Sales-editable window (same rule as the header). */
  editable: boolean;
  /** task_list.validate holders — may confirm the pole-drawing checkpoint. */
  canVerify: boolean;
  /** Product families present on THIS order (derived from the lines). */
  families: OrderedFamily[];
  /** Product Dictionary rows (component_mappings, active only). */
  dictionary: DictionaryItem[];
}) {
  const router = useRouter();
  const [spec, setSpec] = useState<IndustrialSpec>(() =>
    normalizeIndustrialSpec(initialSpec)
  );
  const tiltIsPreset =
    initialTilt != null && TILT_ANGLE_PRESETS.some((p) => p === initialTilt);
  const [tiltChoice, setTiltChoice] = useState<string>(
    initialTilt == null ? "" : tiltIsPreset ? String(initialTilt) : "custom"
  );
  const [tiltCustom, setTiltCustom] = useState<string>(
    initialTilt != null && !tiltIsPreset ? String(initialTilt) : ""
  );
  const tiltValue = tiltChoice === "custom" ? tiltCustom.trim() : tiltChoice;

  const [saving, startTransition] = useTransition();
  const [verifying, startVerify] = useTransition();
  const [aiFinding, startAiFind] = useTransition();
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<
    | { kind: "found"; text: string }
    | { kind: "empty"; text: string }
    | { kind: "error"; text: string }
    | null
  >(null);

  const setTiltFromNumber = (n: number) => {
    if (TILT_ANGLE_PRESETS.some((p) => p === n)) {
      setTiltChoice(String(n));
      setTiltCustom("");
    } else {
      setTiltChoice("custom");
      setTiltCustom(String(n));
    }
  };

  const runAiFind = () => {
    setError(null);
    setAiResult(null);
    const fd = new FormData();
    fd.set("task_list_id", taskListId);
    startAiFind(async () => {
      const res = await aiFindTiltAction(fd);
      if (!res.ok) {
        setAiResult({ kind: "error", text: res.error });
        return;
      }
      if (!res.found) {
        setAiResult({
          kind: "empty",
          text: `No tilt angle found${res.sourceName ? ` in ${res.sourceName}` : ""}. Please enter it manually.`,
        });
        return;
      }
      setTiltFromNumber(res.tilt);
      const bits = [
        `✓ AI found: ${res.tilt}°`,
        res.sourceName ? `Source: ${res.sourceName}${res.sourcePage ? ` — page ${res.sourcePage}` : ""}` : null,
        res.confidence != null ? `Confidence: ${Math.round(res.confidence * 100)}%` : null,
      ].filter(Boolean);
      setAiResult({
        kind: "found",
        text: `${bits.join(" · ")} — applied to the task list (override anytime).`,
      });
      router.refresh();
    });
  };

  const save = () => {
    setError(null);
    if (tiltValue !== "" && cleanTiltAngle(tiltValue) == null) {
      setError("Invalid tilt angle — enter a value between 0 and 90 degrees.");
      return;
    }
    const fd = new FormData();
    fd.set("id", taskListId);
    fd.set("solar_panel_tilt_angle", tiltValue);
    fd.set("industrial_spec", JSON.stringify(spec));
    startTransition(async () => {
      try {
        await updateIndustrialFile(fd);
        setSavedAt(Date.now());
        router.refresh();
      } catch (e: any) {
        setError(e?.message ?? "Failed to save the industrial production file");
      }
    });
  };

  const toggleVerified = (next: boolean) => {
    setError(null);
    const fd = new FormData();
    fd.set("id", taskListId);
    fd.set("verified", next ? "1" : "0");
    startVerify(async () => {
      try {
        await setPoleDrawingTiltVerified(fd);
        router.refresh();
      } catch (e: any) {
        setError(e?.message ?? "Failed to update the checkpoint");
      }
    });
  };

  const setAccessory = (
    idx: number,
    patch: Partial<IndustrialSpec["pole_accessories"]["items"][number]>
  ) =>
    setSpec((s) => ({
      ...s,
      pole_accessories: {
        ...s.pole_accessories,
        items: s.pole_accessories.items.map((it, i) =>
          i === idx ? { ...it, ...patch } : it
        ),
      },
    }));

  const setPart = (idx: number, patch: Partial<SparePartRow>) =>
    setSpec((s) => ({
      ...s,
      spare_parts: s.spare_parts.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    }));

  const addPart = () =>
    setSpec((s) => ({
      ...s,
      spare_parts: [
        ...s.spare_parts,
        {
          part: "",
          model: null,
          product_id: null,
          quantity: 1,
          notes: null,
          factory_name: null,
          customer_name: null,
          factory_notes: null,
          family_category_id: families[0]?.categoryId ?? null,
          family_label: families[0]?.label ?? null,
          dictionary_item_id: null,
          factory_name_cn: null,
          erp_code: null,
        },
      ],
    }));

  const removePart = (idx: number) =>
    setSpec((s) => ({
      ...s,
      spare_parts: s.spare_parts.filter((_, i) => i !== idx),
    }));

  const tiltNumber = tiltValue !== "" ? cleanTiltAngle(tiltValue) : null;
  const packagingCustom = spec.packaging.version === "custom_client";
  const manualCustom = spec.user_manual.brand === "custom";
  const manualNeedsLangs =
    spec.user_manual.brand === "solux" || spec.user_manual.brand === "neutral";

  const inputCls =
    "rounded border border-neutral-200 px-2 py-1 text-sm disabled:bg-neutral-50";
  const microLabel =
    "text-[11px] font-semibold uppercase tracking-wider text-neutral-500";

  return (
    <section className="panel p-4 space-y-5">
      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[11px] text-rose-700">
          {error}
        </div>
      )}

      {/* ---------------- A. Solar panel tilt angle ---------------- */}
      <div>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="eyebrow">Solar panel tilt angle</div>
            <p className="text-xs text-neutral-500 mt-0.5 max-w-2xl">
              Determines the pole drawing and the factory production
              instructions. Seeded from the Service Request — or let the AI
              read it straight from the uploaded Energy Study.
            </p>
          </div>
          <span
            className="text-lg font-semibold tabular-nums shrink-0"
            data-testid="tilt-angle-value"
          >
            {tiltNumber != null ? `${tiltNumber}°` : "—"}
          </span>
        </div>

        {/* AI Find — explicit assist; the found value is applied and stays
            fully overridable via the presets / custom input below. */}
        {editable && (
          <div className="mt-2">
            <button
              type="button"
              onClick={runAiFind}
              disabled={aiFinding}
              data-testid="ai-find-tilt"
              className="inline-flex items-center gap-1.5 rounded-md border border-solux/40 bg-solux/5 px-3 py-1.5 text-xs font-medium text-solux hover:bg-solux/10 disabled:opacity-60"
            >
              {aiFinding ? "Reading the Energy Study…" : "✨ AI Find from Energy Study"}
            </button>
          </div>
        )}
        {aiResult && (
          <div
            data-testid="ai-find-result"
            className={`mt-2 rounded-md border px-3 py-2 text-xs ${
              aiResult.kind === "found"
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : aiResult.kind === "empty"
                  ? "border-amber-300 bg-amber-50 text-amber-900"
                  : "border-rose-200 bg-rose-50 text-rose-700"
            }`}
          >
            {aiResult.text}
          </div>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {TILT_ANGLE_PRESETS.map((a) => {
            const active = tiltChoice === String(a);
            return (
              <button
                key={a}
                type="button"
                disabled={!editable}
                onClick={() => setTiltChoice(active ? "" : String(a))}
                className={`rounded-full border px-2.5 py-1 text-xs disabled:opacity-60 ${
                  active
                    ? "border-solux bg-solux text-white"
                    : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50"
                }`}
              >
                {a}°
              </button>
            );
          })}
          <button
            type="button"
            disabled={!editable}
            onClick={() => setTiltChoice(tiltChoice === "custom" ? "" : "custom")}
            className={`rounded-full border px-2.5 py-1 text-xs disabled:opacity-60 ${
              tiltChoice === "custom"
                ? "border-solux bg-solux text-white"
                : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50"
            }`}
          >
            Custom…
          </button>
          {tiltChoice === "custom" && (
            <input
              type="number"
              min={0}
              max={90}
              step="0.5"
              value={tiltCustom}
              disabled={!editable}
              onChange={(e) => setTiltCustom(e.target.value)}
              placeholder="e.g. 25"
              className={`w-24 ${inputCls}`}
              aria-label="Custom tilt angle (degrees)"
            />
          )}
        </div>

        {/* Pole drawing ↔ tilt checkpoint — the TLM confirms the drawing
            matches the angle. Blocks Release to Production while pending. */}
        <div
          className={`mt-3 rounded-md border px-3 py-2 ${
            tiltNumber == null
              ? "border-neutral-200 bg-neutral-50"
              : tiltVerified
                ? "border-emerald-200 bg-emerald-50"
                : "border-amber-300 bg-amber-50"
          }`}
        >
          <label className="inline-flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={tiltVerified}
              disabled={!canVerify || verifying || tiltNumber == null}
              onChange={(e) => toggleVerified(e.target.checked)}
              className="h-4 w-4 mt-0.5 rounded border-neutral-300 shrink-0"
              data-testid="tilt-checkpoint"
            />
            <span className="text-xs text-neutral-700">
              <b>Pole drawing checkpoint</b> — the pole drawing matches the
              required panel angle
              {tiltNumber != null ? ` (${tiltNumber}°)` : ""}.
              {tiltNumber == null
                ? " Set the tilt angle first."
                : tiltVerified
                  ? ` Verified${tiltVerifiedAt ? ` on ${tiltVerifiedAt.slice(0, 10)}` : ""}.`
                  : " Pending — blocks Release to Production."}
              {!canVerify && tiltNumber != null && (
                <span className="text-neutral-400"> (Task List Manager confirms this.)</span>
              )}
            </span>
          </label>
        </div>
      </div>

      {/* ---------------- B. Pole accessories ---------------- */}
      <div>
        <div className="eyebrow">Pole accessories</div>
        <p className="text-xs text-neutral-500 mt-0.5">
          Included by default with every pole — untick anything this order
          doesn&apos;t need.
        </p>
        <ul className="mt-2 divide-y divide-neutral-100 rounded-md border border-neutral-200">
          {spec.pole_accessories.items.map((it, idx) => (
            <li key={idx} className="px-3 py-2 flex items-center gap-2 flex-wrap">
              <label className="inline-flex items-center gap-2 cursor-pointer min-w-[220px]">
                <input
                  type="checkbox"
                  checked={it.included}
                  disabled={!editable}
                  onChange={(e) => setAccessory(idx, { included: e.target.checked })}
                  className="h-4 w-4 rounded border-neutral-300 shrink-0"
                />
                {it.custom ? (
                  <input
                    value={it.label}
                    disabled={!editable}
                    placeholder="Accessory name"
                    onChange={(e) => setAccessory(idx, { label: e.target.value })}
                    className={`flex-1 min-w-0 ${inputCls}`}
                  />
                ) : (
                  <span
                    className={`text-sm ${
                      it.included ? "font-medium text-neutral-900" : "text-neutral-500 line-through"
                    }`}
                  >
                    {it.label}
                  </span>
                )}
              </label>
              <input
                value={it.note ?? ""}
                disabled={!editable}
                placeholder="Note (optional)"
                onChange={(e) => setAccessory(idx, { note: e.target.value || null })}
                className={`flex-1 min-w-[160px] text-xs ${inputCls}`}
              />
              {it.custom && editable && (
                <button
                  type="button"
                  onClick={() =>
                    setSpec((s) => ({
                      ...s,
                      pole_accessories: {
                        ...s.pole_accessories,
                        items: s.pole_accessories.items.filter((_, i) => i !== idx),
                      },
                    }))
                  }
                  className="text-neutral-400 hover:text-rose-600 text-xs px-1 shrink-0"
                  aria-label="Remove accessory"
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
        {editable && (
          <button
            type="button"
            onClick={() =>
              setSpec((s) => ({
                ...s,
                pole_accessories: {
                  ...s.pole_accessories,
                  items: [
                    ...s.pole_accessories.items,
                    { key: "custom", label: "", included: true, note: null, custom: true },
                  ],
                },
              }))
            }
            className="mt-2 text-[11px] text-neutral-600 hover:text-neutral-900 underline underline-offset-2"
          >
            + Add another accessory
          </button>
        )}
      </div>

      {/* ---------------- C. Packaging version ---------------- */}
      <div>
        <div className="eyebrow">Packaging version</div>
        <p className="text-xs text-neutral-500 mt-0.5">
          Packaging is standardized — pick the version for this order.
        </p>
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {PACKAGING_VERSIONS.map((v) => (
            <label
              key={v.value}
              className={`flex items-start gap-2 rounded-md border px-3 py-2 cursor-pointer ${
                spec.packaging.version === v.value
                  ? "border-solux bg-solux/5"
                  : "border-neutral-200 bg-white hover:bg-neutral-50"
              }`}
            >
              <input
                type="radio"
                name="packaging_version"
                checked={spec.packaging.version === v.value}
                disabled={!editable}
                onChange={() =>
                  setSpec((s) => ({ ...s, packaging: { ...s.packaging, version: v.value } }))
                }
                className="mt-0.5 shrink-0"
              />
              <span>
                <span className="block text-sm font-medium text-neutral-900">{v.label}</span>
                <span className="block text-[11px] text-neutral-500">{v.hint}</span>
              </span>
            </label>
          ))}
        </div>
        {packagingCustom && (
          <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 space-y-2">
            <p className="text-xs text-amber-900">
              <b>Customer branding required.</b> Upload the customer logo (and
              design files if available). Sales is notified automatically when
              this version is saved.
            </p>
            {editable && documentId && (
              <div className="flex items-center gap-2 flex-wrap">
                <InlineLogoUpload
                  documentId={documentId}
                  attachmentType="logo"
                  buttonLabel="Upload customer logo"
                  defaultNote="Packaging — customer logo"
                />
                <InlineLogoUpload
                  documentId={documentId}
                  attachmentType="packaging_artwork"
                  buttonLabel="Upload design files"
                  defaultNote="Packaging — customer design files"
                />
              </div>
            )}
          </div>
        )}
        <input
          value={spec.packaging.notes ?? ""}
          disabled={!editable}
          placeholder="Packaging notes (optional)"
          onChange={(e) =>
            setSpec((s) => ({ ...s, packaging: { ...s.packaging, notes: e.target.value || null } }))
          }
          className={`mt-2 w-full text-xs ${inputCls}`}
        />
      </div>

      {/* ---------------- D. User manual ---------------- */}
      <div>
        <div className="eyebrow">User manual</div>
        <p className="text-xs text-neutral-500 mt-0.5">
          Every order ships with user manuals — configure the version before
          production.
        </p>
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-1.5">
          {USER_MANUAL_BRANDS.map((b) => (
            <label
              key={b.value}
              className={`flex items-start gap-2 rounded-md border px-3 py-2 cursor-pointer ${
                spec.user_manual.brand === b.value
                  ? "border-solux bg-solux/5"
                  : "border-neutral-200 bg-white hover:bg-neutral-50"
              }`}
            >
              <input
                type="radio"
                name="user_manual_brand"
                checked={spec.user_manual.brand === b.value}
                disabled={!editable}
                onChange={() =>
                  setSpec((s) => ({ ...s, user_manual: { ...s.user_manual, brand: b.value } }))
                }
                className="mt-0.5 shrink-0"
              />
              <span>
                <span className="block text-sm font-medium text-neutral-900">{b.label}</span>
                <span className="block text-[11px] text-neutral-500">{b.hint}</span>
              </span>
            </label>
          ))}
        </div>
        {manualNeedsLangs && (
          <div className="mt-2 flex items-center gap-4 flex-wrap">
            <span className={microLabel}>Languages</span>
            {MANUAL_LANGUAGES.map((l) => (
              <label key={l.value} className="inline-flex items-center gap-1.5 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={spec.user_manual.languages.includes(l.value)}
                  disabled={!editable}
                  onChange={(e) =>
                    setSpec((s) => ({
                      ...s,
                      user_manual: {
                        ...s.user_manual,
                        languages: e.target.checked
                          ? [...s.user_manual.languages, l.value]
                          : s.user_manual.languages.filter((x) => x !== l.value),
                      },
                    }))
                  }
                  className="h-4 w-4 rounded border-neutral-300"
                />
                {l.label}
              </label>
            ))}
          </div>
        )}
        {manualCustom && (
          <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 space-y-2">
            <p className="text-xs text-amber-900">
              <b>Customer manual artwork required.</b> Upload the customer&apos;s
              manual artwork — or their logo and design assets — before
              production.
            </p>
            {editable && documentId && (
              <InlineLogoUpload
                documentId={documentId}
                attachmentType="packaging_artwork"
                buttonLabel="Upload manual artwork"
                defaultNote="User manual — customer artwork / design assets"
              />
            )}
          </div>
        )}
        <input
          value={spec.user_manual.notes ?? ""}
          disabled={!editable}
          placeholder="Manual notes (optional)"
          onChange={(e) =>
            setSpec((s) => ({ ...s, user_manual: { ...s.user_manual, notes: e.target.value || null } }))
          }
          className={`mt-2 w-full text-xs ${inputCls}`}
        />
      </div>

      {/* ---------------- E. Free spare parts (product-aware, m160) -------- */}
      <div>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="eyebrow">Free spare parts</div>
            <p className="text-xs text-neutral-500 mt-0.5 max-w-2xl">
              Product-aware: pick the ordered family, then a part from the
              Product Dictionary — the official factory reference, Chinese
              terminology and ERP code fill in automatically (override
              anytime). Production packs it, After-Sales tracks it.
            </p>
          </div>
          <span className="text-[11px] text-neutral-400 tabular-nums shrink-0">
            {spec.spare_parts.length} part{spec.spare_parts.length === 1 ? "" : "s"}
          </span>
        </div>

        <div className="mt-2 space-y-2">
          {spec.spare_parts.map((r, idx) => (
            <SparePartCard
              key={idx}
              row={r}
              families={families}
              dictionary={dictionary}
              editable={editable}
              onChange={(patch) => setPart(idx, patch)}
              onRemove={() => removePart(idx)}
            />
          ))}
        </div>

        {editable && (
          <button
            type="button"
            onClick={addPart}
            data-testid="add-spare-part"
            className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
          >
            + Add spare part
          </button>
        )}
        {dictionary.length === 0 && editable && (
          <p className="mt-1 text-[11px] text-neutral-400">
            The Product Dictionary is empty — fill it in Admin → Industrial
            dictionary to get compatible-part suggestions here.
          </p>
        )}
      </div>

      {editable && (
        <div className="flex items-center justify-end gap-2 border-t border-neutral-100 pt-3">
          {savedAt && !saving && (
            <span className="text-[11px] text-emerald-700">Saved</span>
          )}
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded bg-solux px-4 py-2 text-white text-sm font-medium hover:bg-solux-dark disabled:opacity-60"
            data-testid="save-industrial-file"
          >
            {saving ? "Saving…" : "Save industrial file"}
          </button>
        </div>
      )}
    </section>
  );
}

const CUSTOM_PART = "__custom__";

/**
 * One spare part as a full card: family → dictionary part → auto-filled
 * factory naming, with quantity/notes. The dictionary pick is a SNAPSHOT
 * (kept even if the dictionary changes later) and every field stays
 * editable — the dictionary assists, never dictates.
 */
function SparePartCard({
  row,
  families,
  dictionary,
  editable,
  onChange,
  onRemove,
}: {
  row: SparePartRow;
  families: OrderedFamily[];
  dictionary: DictionaryItem[];
  editable: boolean;
  onChange: (patch: Partial<SparePartRow>) => void;
  onRemove: () => void;
}) {
  const family: OrderedFamily = useMemo(() => {
    const found = families.find((f) => f.categoryId === (row.family_category_id ?? null));
    return (
      found ?? {
        categoryId: row.family_category_id ?? null,
        label: row.family_label ?? "Other / general",
        productIds: [],
      }
    );
  }, [families, row.family_category_id, row.family_label]);

  const familyItems = useMemo(
    () => groupItemsByType(itemsForFamily(dictionary, family)),
    [dictionary, family]
  );

  const cellInput =
    "w-full rounded border border-neutral-200 px-2 py-1 text-sm disabled:bg-neutral-50";
  const lbl = "text-[10px] uppercase tracking-wider text-neutral-500";

  const pickItem = (id: string) => {
    if (id === CUSTOM_PART || id === "") {
      onChange({ dictionary_item_id: null });
      return;
    }
    const it = dictionary.find((d) => d.id === id);
    if (!it) return;
    const fill = factoryFillFromItem(it);
    onChange({
      dictionary_item_id: it.id,
      part: fill.part,
      model: fill.model,
      factory_name: fill.factory_name,
      factory_name_cn: fill.factory_name_cn,
      erp_code: fill.erp_code,
    });
  };

  return (
    <div className="rounded-md border border-neutral-200 bg-white p-3" data-testid="spare-part-card">
      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
        <label className="block sm:col-span-4">
          <span className={lbl}>Product family</span>
          <select
            value={row.family_category_id ?? ""}
            disabled={!editable}
            onChange={(e) => {
              const fam =
                families.find((f) => (f.categoryId ?? "") === e.target.value) ?? null;
              onChange({
                family_category_id: fam?.categoryId ?? null,
                family_label: fam?.label ?? null,
                // Family changed → the previous dictionary pick may no longer
                // be compatible; drop the anchor, keep the typed values.
                dictionary_item_id: null,
              });
            }}
            className={cellInput}
          >
            {families.map((f) => (
              <option key={f.categoryId ?? "other"} value={f.categoryId ?? ""}>
                {f.label}
              </option>
            ))}
            {!families.some((f) => f.categoryId == null) && (
              <option value="">Other / general</option>
            )}
          </select>
        </label>
        <label className="block sm:col-span-5">
          <span className={lbl}>Part (from dictionary)</span>
          <select
            value={row.dictionary_item_id ?? CUSTOM_PART}
            disabled={!editable}
            onChange={(e) => pickItem(e.target.value)}
            className={cellInput}
            data-testid="spare-part-pick"
          >
            <option value={CUSTOM_PART}>Custom part…</option>
            {familyItems.map((g) => (
              <optgroup key={g.type} label={g.type}>
                {g.items.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.commercial_name}
                    {it.internal_reference ? ` — ${it.internal_reference}` : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="block sm:col-span-2">
          <span className={lbl}>Quantity</span>
          <input
            type="number"
            min={0}
            value={row.quantity}
            disabled={!editable}
            onChange={(e) =>
              onChange({ quantity: Math.max(0, Math.round(Number(e.target.value) || 0)) })
            }
            className={`${cellInput} text-right tabular-nums`}
          />
        </label>
        {editable && (
          <div className="sm:col-span-1 flex items-end justify-end">
            <button
              type="button"
              onClick={onRemove}
              className="text-neutral-400 hover:text-rose-600 text-xs px-1 pb-1.5"
              aria-label="Remove spare part"
            >
              ✕
            </button>
          </div>
        )}

        <label className="block sm:col-span-4">
          <span className={lbl}>Part name</span>
          <input
            value={row.part}
            disabled={!editable}
            placeholder="e.g. Battery"
            onChange={(e) => onChange({ part: e.target.value })}
            className={cellInput}
          />
        </label>
        <label className="block sm:col-span-4">
          <span className={lbl}>Model / reference</span>
          <input
            value={row.model ?? ""}
            disabled={!editable}
            placeholder="e.g. LFP25-65AH-V6"
            onChange={(e) => onChange({ model: e.target.value || null })}
            className={`${cellInput} font-mono text-[13px]`}
          />
        </label>
        <label className="block sm:col-span-4">
          <span className={lbl}>ERP code</span>
          <input
            value={row.erp_code ?? ""}
            disabled={!editable}
            placeholder="ERP code"
            onChange={(e) => onChange({ erp_code: e.target.value || null })}
            className={`${cellInput} font-mono text-[13px]`}
          />
        </label>

        <label className="block sm:col-span-4">
          <span className={lbl}>Factory name</span>
          <input
            value={row.factory_name ?? ""}
            disabled={!editable}
            placeholder="Official factory reference"
            onChange={(e) => onChange({ factory_name: e.target.value || null })}
            className={cellInput}
          />
        </label>
        <label className="block sm:col-span-4">
          <span className={lbl}>Factory name (中文)</span>
          <input
            value={row.factory_name_cn ?? ""}
            disabled={!editable}
            placeholder="e.g. 25.6V 65Ah 磷酸铁锂电池"
            onChange={(e) => onChange({ factory_name_cn: e.target.value || null })}
            className={cellInput}
          />
        </label>
        <label className="block sm:col-span-4">
          <span className={lbl}>Customer name</span>
          <input
            value={row.customer_name ?? ""}
            disabled={!editable}
            placeholder="e.g. Solar Controller"
            onChange={(e) => onChange({ customer_name: e.target.value || null })}
            className={cellInput}
          />
        </label>

        <label className="block sm:col-span-6">
          <span className={lbl}>Notes</span>
          <input
            value={row.notes ?? ""}
            disabled={!editable}
            placeholder="Packing / after-sales notes"
            onChange={(e) => onChange({ notes: e.target.value || null })}
            className={cellInput}
          />
        </label>
        <label className="block sm:col-span-6">
          <span className={lbl}>Factory notes</span>
          <input
            value={row.factory_notes ?? ""}
            disabled={!editable}
            placeholder="e.g. use this factory's exact wording"
            onChange={(e) => onChange({ factory_notes: e.target.value || null })}
            className={cellInput}
          />
        </label>
      </div>
    </div>
  );
}
