"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  updateIndustrialFile,
  setPoleDrawingTiltVerified,
} from "@/app/(app)/task-lists/[id]/actions";
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

export type ProductOption = { id: string; name: string; sku: string | null };

/**
 * IndustrialFileEditor (m159) — the "Industrial production file" section of a
 * task list: solar-panel tilt angle (+ pole-drawing checkpoint), pole
 * accessories, packaging version, user manuals and the structured spare-parts
 * table. One Save persists the whole file (tilt + spec) through
 * updateIndustrialFile; the TLM checkpoint saves instantly on toggle.
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
  products,
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
  /** Catalog products for the spare-part model picker (datalist). */
  products: ProductOption[];
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
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const setAccessory = (idx: number, patch: Partial<IndustrialSpec["pole_accessories"]["items"][number]>) =>
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
              instructions. Seeded from the Service Request, auto-filled from
              the Energy Study by the AI assist — a manual value always wins.
            </p>
          </div>
          <span
            className="text-lg font-semibold tabular-nums shrink-0"
            data-testid="tilt-angle-value"
          >
            {tiltNumber != null ? `${tiltNumber}°` : "—"}
          </span>
        </div>
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

      {/* ---------------- E. Free spare parts ---------------- */}
      <div>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="eyebrow">Free spare parts</div>
            <p className="text-xs text-neutral-500 mt-0.5 max-w-2xl">
              Structured list — production packs it, After-Sales tracks it. Use
              the factory naming fields when a factory calls the same part
              differently.
            </p>
          </div>
          <span className="text-[11px] text-neutral-400 tabular-nums shrink-0">
            {spec.spare_parts.length} part{spec.spare_parts.length === 1 ? "" : "s"}
          </span>
        </div>
        {spec.spare_parts.length > 0 && (
          <div className="mt-2 overflow-x-auto rounded-md border border-neutral-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-neutral-50 text-left text-[11px] uppercase tracking-wider text-neutral-500">
                  <th className="px-2 py-1.5 font-semibold">Spare part</th>
                  <th className="px-2 py-1.5 font-semibold">Model</th>
                  <th className="px-2 py-1.5 font-semibold w-20">Qty</th>
                  <th className="px-2 py-1.5 font-semibold">Notes</th>
                  {editable && <th className="w-8" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {spec.spare_parts.map((r, idx) => (
                  <SparePartRowEditor
                    key={idx}
                    row={r}
                    editable={editable}
                    products={products}
                    onChange={(patch) => setPart(idx, patch)}
                    onRemove={() => removePart(idx)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {editable && (
          <button
            type="button"
            onClick={addPart}
            className="mt-2 text-[11px] text-neutral-600 hover:text-neutral-900 underline underline-offset-2"
            data-testid="add-spare-part"
          >
            + Add spare part
          </button>
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

/** One spare-part row + its expandable factory-naming sub-row. */
function SparePartRowEditor({
  row,
  editable,
  products,
  onChange,
  onRemove,
}: {
  row: SparePartRow;
  editable: boolean;
  products: ProductOption[];
  onChange: (patch: Partial<SparePartRow>) => void;
  onRemove: () => void;
}) {
  const [namingOpen, setNamingOpen] = useState(
    !!(row.factory_name || row.customer_name || row.factory_notes)
  );
  const cellInput =
    "w-full rounded border border-neutral-200 px-2 py-1 text-sm disabled:bg-neutral-50";
  const hasNaming = !!(row.factory_name || row.customer_name || row.factory_notes);

  return (
    <>
      <tr>
        <td className="px-2 py-1.5 min-w-[140px]">
          <input
            value={row.part}
            disabled={!editable}
            placeholder="e.g. Battery"
            onChange={(e) => onChange({ part: e.target.value })}
            className={cellInput}
          />
        </td>
        <td className="px-2 py-1.5 min-w-[160px]">
          {/* datalist = free text OR a catalog model pick */}
          <input
            value={row.model ?? ""}
            disabled={!editable}
            placeholder="Model / reference"
            list="industrial-spare-part-models"
            onChange={(e) => {
              const v = e.target.value;
              const match = products.find(
                (pr) => pr.name === v || (pr.sku != null && pr.sku === v)
              );
              onChange({ model: v || null, product_id: match?.id ?? null });
            }}
            className={cellInput}
          />
        </td>
        <td className="px-2 py-1.5">
          <input
            type="number"
            min={0}
            value={row.quantity}
            disabled={!editable}
            onChange={(e) => onChange({ quantity: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
            className={`${cellInput} text-right tabular-nums`}
          />
        </td>
        <td className="px-2 py-1.5 min-w-[160px]">
          <div className="flex items-center gap-1.5">
            <input
              value={row.notes ?? ""}
              disabled={!editable}
              placeholder="Notes"
              onChange={(e) => onChange({ notes: e.target.value || null })}
              className={cellInput}
            />
            <button
              type="button"
              onClick={() => setNamingOpen((o) => !o)}
              className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] ${
                hasNaming
                  ? "border-solux/40 bg-solux/10 text-solux"
                  : "border-neutral-200 text-neutral-500 hover:text-neutral-800"
              }`}
              title="Internal naming / factory notes"
            >
              Factory naming {namingOpen ? "▴" : "▾"}
            </button>
          </div>
        </td>
        {editable && (
          <td className="px-1 py-1.5 text-center">
            <button
              type="button"
              onClick={onRemove}
              className="text-neutral-400 hover:text-rose-600 text-xs"
              aria-label="Remove spare part"
            >
              ✕
            </button>
          </td>
        )}
      </tr>
      {namingOpen && (
        <tr className="bg-neutral-50/60">
          <td colSpan={editable ? 5 : 4} className="px-2 py-2">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <label className="block">
                <span className="text-[10px] uppercase tracking-wider text-neutral-500">Factory name</span>
                <input
                  value={row.factory_name ?? ""}
                  disabled={!editable}
                  placeholder="e.g. MPPT Controller V6"
                  onChange={(e) => onChange({ factory_name: e.target.value || null })}
                  className={cellInput}
                />
              </label>
              <label className="block">
                <span className="text-[10px] uppercase tracking-wider text-neutral-500">Customer name</span>
                <input
                  value={row.customer_name ?? ""}
                  disabled={!editable}
                  placeholder="e.g. Solar Controller"
                  onChange={(e) => onChange({ customer_name: e.target.value || null })}
                  className={cellInput}
                />
              </label>
              <label className="block">
                <span className="text-[10px] uppercase tracking-wider text-neutral-500">Factory notes</span>
                <input
                  value={row.factory_notes ?? ""}
                  disabled={!editable}
                  placeholder="e.g. use this factory's exact wording"
                  onChange={(e) => onChange({ factory_notes: e.target.value || null })}
                  className={cellInput}
                />
              </label>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/** Shared datalist for the spare-part model pickers (render once per page). */
export function SparePartModelDatalist({ products }: { products: ProductOption[] }) {
  return (
    <datalist id="industrial-spare-part-models">
      {products.map((p) => (
        <option key={p.id} value={p.name}>
          {p.sku ?? undefined}
        </option>
      ))}
    </datalist>
  );
}
