"use client";

import type { DocumentLine, Currency } from "@/lib/types";
import {
  ARM_TYPE_OPTIONS,
  HEIGHT_REFERENCE_OPTIONS,
  SURFACE_TREATMENT_OPTIONS,
  buildPoleDescription,
  emptyPoleSpec,
  poleSpecFromConfigValues,
  poleSpecToConfigValues,
  validatePoleSpec,
  type ArmType,
  type HeightReference,
  type PoleSpec,
  type SurfaceTreatment,
} from "@/lib/custom-pole";

/**
 * Editor for a single CUSTOM POLE (mât) quotation line — a fast, commercial
 * form, NOT the full production configuration. Fully controlled: the line in
 * the parent's `lines` state is the source of truth, so the pole persists and
 * reloads like any other line. Every edit rebuilds the line's
 * client_product_name (the client-facing description) + config_values (the
 * structured spec) and keeps the price sales-entered (pricing_mode "manual").
 */
export default function CustomPoleCard({
  line,
  currency,
  onChange,
  onRemove,
}: {
  line: DocumentLine;
  currency: Currency;
  onChange: (line: DocumentLine) => void;
  onRemove: () => void;
}) {
  const spec = poleSpecFromConfigValues(line.config_values) ?? emptyPoleSpec();
  const qty = Number(line.quantity || 0);
  const unit = Number(line.unit_price || 0);
  const heightError = validatePoleSpec(spec);

  const emit = (nextSpec: PoleSpec, nextQty: number, nextUnit: number) => {
    onChange({
      ...line,
      product_id: "",
      category_id: null,
      selected_options: {},
      quantity: nextQty,
      unit_price: nextUnit,
      original_unit_price: nextUnit,
      total_price: Number((nextQty * nextUnit).toFixed(2)),
      pricing_mode: "manual",
      pricing_source: "manual",
      client_product_name: buildPoleDescription(nextSpec),
      config_values: poleSpecToConfigValues(nextSpec),
    });
  };
  const patchSpec = (p: Partial<PoleSpec>) => emit({ ...spec, ...p }, qty, unit);
  const setQty = (v: number) => emit(spec, Math.max(0, v), unit);
  const setUnit = (v: number) => emit(spec, qty, Math.max(0, v));

  const numVal = (v: number | null) => (v != null ? String(v) : "");
  const parseNum = (s: string): number | null => {
    const n = Number((s || "").replace(",", "."));
    return s.trim() === "" || !Number.isFinite(n) ? null : n;
  };

  const label = "block text-sm font-medium";
  const input = "mt-1 w-full rounded border px-3 py-2";
  const hint = "mt-1 block text-[11px] text-neutral-500";

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50/40 p-4 space-y-4">
      {/* Header — clearly a custom line, not a catalogue product */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-800">
            Custom pole
          </span>
          <p className="mt-1 text-[12px] text-neutral-600">
            This is a custom pole line. Specifications and price are entered
            manually — it is not a catalogue product.
          </p>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 rounded border border-neutral-200 px-2 py-1 text-xs text-neutral-600 hover:bg-white hover:text-rose-600"
        >
          Remove
        </button>
      </div>

      {/* Quantity + Unit price */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <label className={label}>
          Quantity *
          <input
            type="number"
            min={1}
            step={1}
            value={qty || ""}
            onChange={(e) => setQty(Number(e.target.value) || 0)}
            className={`${input} tabular-nums`}
          />
        </label>
        <label className={label}>
          Unit selling price * ({currency})
          <input
            type="number"
            min={0}
            step="0.01"
            value={unit || ""}
            onChange={(e) => setUnit(Number(e.target.value) || 0)}
            placeholder="0.00"
            className={`${input} tabular-nums`}
          />
        </label>
        <div className={label}>
          Line total
          <div className="mt-1 rounded border border-neutral-200 bg-white px-3 py-2 text-right tabular-nums">
            {currency} {(qty * unit).toFixed(2)}
          </div>
        </div>
      </div>

      {/* Height reference + heights */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <label className={label}>
          Height reference *
          <select
            value={spec.heightReference}
            onChange={(e) =>
              patchSpec({ heightReference: e.target.value as HeightReference })
            }
            className={input}
          >
            {HEIGHT_REFERENCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <span className={hint}>
            Choose whether the entered height refers to the full pole height or
            to the light point height.
          </span>
        </label>
        <label className={label}>
          Total pole height (m)
          <input
            type="number"
            min={0}
            step="0.1"
            value={numVal(spec.totalPoleHeightM)}
            onChange={(e) =>
              patchSpec({ totalPoleHeightM: parseNum(e.target.value) })
            }
            placeholder="e.g. 8"
            className={`${input} tabular-nums`}
          />
        </label>
        <label className={label}>
          Light point height (m)
          <input
            type="number"
            min={0}
            step="0.1"
            value={numVal(spec.lightPointHeightM)}
            onChange={(e) =>
              patchSpec({ lightPointHeightM: parseNum(e.target.value) })
            }
            placeholder="e.g. 7"
            className={`${input} tabular-nums`}
          />
        </label>
      </div>
      {heightError && (
        <p className="text-[12px] font-medium text-rose-600">{heightError}</p>
      )}

      {/* Arm type + length */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <label className={label}>
          Arm type *
          <select
            value={spec.armType}
            onChange={(e) => patchSpec({ armType: e.target.value as ArmType })}
            className={input}
          >
            {ARM_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Arm length (m)
          <input
            type="number"
            min={0}
            step="0.1"
            value={numVal(spec.armLengthM)}
            onChange={(e) => patchSpec({ armLengthM: parseNum(e.target.value) })}
            placeholder="e.g. 1.5"
            disabled={spec.armType === "no_arm"}
            className={`${input} tabular-nums disabled:bg-neutral-100 disabled:text-neutral-400`}
          />
        </label>
        <label className={label}>
          Pole thickness (mm)
          <input
            type="number"
            min={0}
            step="0.1"
            value={numVal(spec.thicknessMm)}
            onChange={(e) => patchSpec({ thicknessMm: parseNum(e.target.value) })}
            placeholder="e.g. 4"
            className={`${input} tabular-nums`}
          />
        </label>
      </div>

      {/* Treatment + painting */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <label className={label}>
          Surface treatment
          <select
            value={spec.surfaceTreatment ?? "hot_dip_galvanized"}
            onChange={(e) =>
              patchSpec({ surfaceTreatment: e.target.value as SurfaceTreatment })
            }
            className={input}
          >
            {SURFACE_TREATMENT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Painting
          <select
            value={spec.painting ? "included" : "none"}
            onChange={(e) =>
              patchSpec({
                painting: e.target.value === "included",
                ralColor: e.target.value === "included" ? spec.ralColor : null,
              })
            }
            className={input}
          >
            <option value="none">No painting</option>
            <option value="included">Painting included</option>
          </select>
        </label>
        {spec.painting && (
          <label className={label}>
            RAL color
            <input
              type="text"
              value={spec.ralColor ?? ""}
              onChange={(e) =>
                patchSpec({ ralColor: e.target.value.trim() || null })
              }
              placeholder="e.g. RAL 7016"
              className={input}
            />
          </label>
        )}
      </div>

      {/* Optional note */}
      <label className={label}>
        Optional note
        <input
          type="text"
          value={spec.note ?? ""}
          onChange={(e) => patchSpec({ note: e.target.value || null })}
          placeholder="e.g. Exact thickness to be confirmed by factory"
          className={input}
        />
      </label>

      {/* Live description preview — exactly what the client sees on the quote */}
      <div className="rounded border border-neutral-200 bg-white px-3 py-2 text-[13px]">
        <span className="text-[11px] uppercase tracking-wide text-neutral-400">
          Quote line
        </span>
        <div className="mt-0.5 font-medium text-neutral-800">
          {buildPoleDescription(spec)}
        </div>
      </div>
    </div>
  );
}
