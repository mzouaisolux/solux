"use client";

import { useState, useTransition } from "react";
import {
  CONFIG_FIELD_TYPES,
  CONFIG_FIELD_TYPE_HINT,
  CONFIG_FIELD_TYPE_ICON,
  CONFIG_FIELD_TYPE_LABEL,
  type ConfigField,
  type ConfigFieldAccess,
  type ConfigFieldOption,
  type ConfigFieldScope,
  type ConfigFieldType,
} from "@/lib/types";
import {
  addFieldOption,
  addFieldOptionsBulk,
  createConfigField,
  deleteConfigField,
  deleteFieldOption,
  duplicateConfigField,
  updateConfigField,
} from "../actions";

/** Big radio-style cards for picking the field type. */
function TypePicker({
  value,
  onChange,
  name,
}: {
  value: ConfigFieldType;
  onChange: (t: ConfigFieldType) => void;
  name: string;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
      {/* Hidden input keeps the form payload in sync — submit reads this. */}
      <input type="hidden" name={name} value={value} />
      {CONFIG_FIELD_TYPES.map((t) => {
        const selected = value === t;
        return (
          <button
            key={t}
            type="button"
            onClick={() => onChange(t)}
            className={`group rounded-lg border p-3 text-left transition ${
              selected
                ? "border-solux bg-solux/5 ring-1 ring-solux"
                : "border-neutral-200 bg-white hover:border-neutral-300 hover:bg-neutral-50"
            }`}
          >
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex h-7 w-7 items-center justify-center rounded text-sm font-semibold ${
                  selected
                    ? "bg-solux text-white"
                    : "bg-neutral-100 text-neutral-700"
                }`}
              >
                {CONFIG_FIELD_TYPE_ICON[t]}
              </span>
              <div className="font-medium text-sm">
                {CONFIG_FIELD_TYPE_LABEL[t]}
              </div>
            </div>
            <p className="text-[11px] text-neutral-500 mt-1.5 leading-snug">
              {CONFIG_FIELD_TYPE_HINT[t]}
            </p>
          </button>
        );
      })}
    </div>
  );
}

/** Inline hidden-input that submits the current value for a radio group. */
function HiddenValue({ name, value }: { name: string; value: string }) {
  return <input type="hidden" name={name} value={value} />;
}

/** Compact card-radio used for Field Responsibility and Access Level. */
function RadioCard({
  selected,
  onClick,
  label,
  hint,
  color = "neutral",
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
  hint: string;
  color?: "neutral" | "sky" | "amber" | "rose";
}) {
  const ring: Record<string, string> = {
    neutral: "border-solux ring-solux bg-solux/5",
    sky: "border-sky-500 ring-sky-500 bg-sky-50",
    amber: "border-amber-500 ring-amber-500 bg-amber-50",
    rose: "border-rose-500 ring-rose-500 bg-rose-50",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-lg border p-2.5 text-left transition ${
        selected
          ? `${ring[color]} ring-1`
          : "border-neutral-200 bg-white hover:border-neutral-300 hover:bg-neutral-50"
      }`}
    >
      <div className="text-xs font-semibold text-neutral-800">{label}</div>
      <div className="text-[10px] text-neutral-500 mt-0.5 leading-snug">{hint}</div>
    </button>
  );
}

/** Visibility & behavior toggles rendered as compact pill switches. */
function PillToggle({
  name,
  defaultChecked,
  label,
  hint,
  tone = "neutral",
}: {
  name: string;
  defaultChecked?: boolean;
  label: string;
  hint?: string;
  tone?: "neutral" | "amber";
}) {
  const [on, setOn] = useState(!!defaultChecked);
  const color =
    tone === "amber"
      ? on
        ? "border-amber-400 bg-amber-50 text-amber-900"
        : "border-neutral-200 bg-white text-neutral-700"
      : on
      ? "border-solux bg-solux/10 text-neutral-900"
      : "border-neutral-200 bg-white text-neutral-700";
  return (
    <label
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs cursor-pointer select-none transition ${color}`}
      title={hint}
    >
      <input
        type="checkbox"
        name={name}
        checked={on}
        onChange={(e) => setOn(e.target.checked)}
        className="h-3.5 w-3.5"
      />
      <span className="font-medium">{label}</span>
    </label>
  );
}

/** Inline form for adding a brand-new field. */
export function NewFieldForm({
  categoryId,
  startingOrder,
}: {
  categoryId: string;
  startingOrder: number;
}) {
  const [fieldType, setFieldType] = useState<ConfigFieldType>("dropdown");
  const [scope, setScope] = useState<ConfigFieldScope>("sales");
  const [access, setAccess] = useState<ConfigFieldAccess>("everyone");
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Bumping this key forces React to remount the form, which clears all
  // uncontrolled inputs (field name, placeholder, bulk options, etc.).
  const [formKey, setFormKey] = useState(0);

  async function handleCreate(formData: FormData) {
    setSubmitting(true);
    try {
      await createConfigField(formData);
      setOpen(false);
      setFieldType("dropdown");
      setScope("sales");
      setAccess("everyone");
      setFormKey((k) => k + 1);
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    // Closed: compact trigger, right-aligned in its own full-width row so it
    // never competes for horizontal space with the section heading.
    return (
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="btn-primary"
        >
          + Add a new field
        </button>
      </div>
    );
  }

  return (
    <form
      key={formKey}
      action={handleCreate}
      className="panel p-5 space-y-5 border-solux/30 w-full"
    >
      <input type="hidden" name="category_id" value={categoryId} />
      <input type="hidden" name="field_order" value={startingOrder} />

      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">New configuration field</h3>
          <p className="text-xs text-neutral-500 mt-0.5">
            Pick a type, name the field, and (for dropdowns) define the options
            sales users will pick from.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-neutral-500 hover:text-neutral-900"
        >
          Cancel
        </button>
      </div>

      <div>
        <div className="eyebrow mb-1.5">Field type</div>
        <TypePicker value={fieldType} onChange={setFieldType} name="field_type" />
      </div>

      {/* ── FIELD RESPONSIBILITY ─────────────────────────────── */}
      <div>
        <div className="eyebrow mb-1.5">Field Responsibility</div>
        <p className="text-[11px] text-neutral-500 mb-2">Who fills this field?</p>
        <HiddenValue name="field_scope" value={scope} />
        <div className="flex gap-2">
          <RadioCard
            selected={scope === "sales"}
            onClick={() => setScope("sales")}
            label="Sales"
            hint="Quotation builder — editable by sales team"
            color="sky"
          />
          <RadioCard
            selected={scope === "technical"}
            onClick={() => setScope("technical")}
            label="Technical"
            hint="Task list review — editable by TLM + admin"
            color="amber"
          />
          <RadioCard
            selected={scope === "both"}
            onClick={() => setScope("both")}
            label="Both"
            hint="Editable in quotation and task list"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="block">
          <div className="eyebrow mb-1">Field label</div>
          <input
            name="field_name"
            required
            placeholder="e.g. Battery type, CCT, Laser logo"
            className="w-full rounded-md border border-neutral-200 px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <div className="eyebrow mb-1">
            {fieldType === "checkbox"
              ? "Checkbox label (optional)"
              : "Placeholder / hint (optional)"}
          </div>
          <input
            name="placeholder"
            placeholder={
              fieldType === "checkbox"
                ? 'Shown next to the checkbox — e.g. "Yes, include laser logo"'
                : "Helper text shown inside the input"
            }
            className="w-full rounded-md border border-neutral-200 px-3 py-2 text-sm"
          />
        </label>
      </div>

      {(fieldType === "dropdown" || fieldType === "checkbox_group") && (
        <div className="rounded-md border border-neutral-200 bg-neutral-50/60 p-4 space-y-3">
          <div>
            <div className="text-xs font-semibold text-neutral-700">
              Available options
            </div>
            <p className="text-[11px] text-neutral-500">
              {fieldType === "checkbox_group"
                ? "One option per line — sales users can tick multiple items."
                : "One option per line — sales users will pick from this list."}
            </p>
          </div>
          <textarea
            name="bulk_options"
            rows={7}
            placeholder={
              fieldType === "checkbox_group"
                ? `Marine treatment\nBird spike\nAnti-theft kit\nSpecial logo`
                : `12.8V 24Ah\n12.8V 30Ah\n25.6V 42Ah`
            }
            className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm font-mono leading-relaxed"
          />
          {fieldType === "dropdown" && (
            <PillToggle
              name="allow_custom_value"
              label="Allow custom value"
              hint='When enabled, sales users can pick "Custom…" and type their own value.'
            />
          )}
        </div>
      )}

      {fieldType !== "checkbox" && (
        <label className="block">
          <div className="eyebrow mb-1">Default value (optional)</div>
          <input
            name="default_value"
            placeholder={
              fieldType === "dropdown"
                ? "Must match exactly one of the options above"
                : ""
            }
            className="w-full rounded-md border border-neutral-200 px-3 py-2 text-sm"
          />
        </label>
      )}

      {/* ── REQUIRED RULES ──────────────────────────────────── */}
      <div className="border-t border-neutral-100 pt-4 space-y-2">
        <div className="eyebrow">Required Rules</div>
        <p className="text-[11px] text-neutral-500">Required before:</p>
        <div className="flex flex-wrap gap-2">
          <PillToggle
            name="required"
            label="Quotation approval"
            hint="Must be filled before the quotation can be approved."
          />
          <PillToggle
            name="required_for_production"
            label="Production release"
            hint="Must be filled before a production order can be released."
          />
        </div>
      </div>

      {/* ── VISIBILITY ──────────────────────────────────────── */}
      <div className="border-t border-neutral-100 pt-4 space-y-2">
        <div className="eyebrow">Visible In</div>
        <div className="flex flex-wrap gap-2">
          <PillToggle
            name="visible_in_quotation"
            defaultChecked
            label="Quotation Builder"
            hint="Shown to sales when building a quotation."
          />
          <PillToggle
            name="visible_in_task_list"
            defaultChecked
            label="Task List"
            hint="Shown to the task list manager during production setup."
          />
          <PillToggle
            name="visible_in_factory"
            defaultChecked
            label="Factory View"
            hint="Included in the factory-facing production document."
          />
        </div>
      </div>

      {/* ── ACCESS LEVEL ────────────────────────────────────── */}
      <div className="border-t border-neutral-100 pt-4 space-y-2">
        <div className="eyebrow">Access Level</div>
        <p className="text-[11px] text-neutral-500">Who can see this field?</p>
        <HiddenValue name="access_level" value={access} />
        <div className="flex gap-2">
          <RadioCard
            selected={access === "everyone"}
            onClick={() => setAccess("everyone")}
            label="Everyone"
            hint="All roles — visible in customer PDF"
          />
          <RadioCard
            selected={access === "internal"}
            onClick={() => setAccess("internal")}
            label="Internal only"
            hint="Hidden from customer PDF / quotation"
            color="amber"
          />
          <RadioCard
            selected={access === "admin"}
            onClick={() => setAccess("admin")}
            label="Admin only"
            hint="Only visible to admin and super admin"
            color="rose"
          />
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-neutral-100 pt-3">
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={submitting}
          className="btn-secondary"
        >
          Cancel
        </button>
        <button type="submit" disabled={submitting} className="btn-primary">
          {submitting ? "Creating…" : "Create field"}
        </button>
      </div>
    </form>
  );
}

/** Card-style editor for one existing field. */
export function FieldCard({
  field,
  options,
  categoryId,
}: {
  field: ConfigField;
  options: ConfigFieldOption[];
  categoryId: string;
}) {
  const [fieldType, setFieldType] = useState<ConfigFieldType>(field.field_type);
  const [scope, setScope] = useState<ConfigFieldScope>(
    (field.field_scope ?? "sales") as ConfigFieldScope
  );
  const [access, setAccess] = useState<ConfigFieldAccess>(
    (field.access_level ?? (field.internal_only ? "internal" : "everyone")) as ConfigFieldAccess
  );
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  // Quick-add UI for new options (single line, with Enter to submit).
  function QuickAddOption() {
    const [val, setVal] = useState("");
    return (
      <form
        action={(fd) => {
          startTransition(async () => {
            await addFieldOption(fd);
            setVal("");
          });
        }}
        className="flex items-center gap-2"
      >
        <input type="hidden" name="field_id" value={field.id} />
        <input type="hidden" name="category_id" value={categoryId} />
        <input
          type="hidden"
          name="option_order"
          value={(options.length + 1) * 10}
        />
        <input
          name="option_value"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder="Add an option…"
          required
          className="flex-1 min-w-0 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm"
        />
        <button
          type="submit"
          disabled={pending || !val.trim()}
          className="btn-secondary text-sm shrink-0"
        >
          + Add
        </button>
      </form>
    );
  }

  return (
    <div className="panel p-4 space-y-3">
      {/* Header: name + type pill + actions */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-base font-semibold leading-tight">
              {field.field_name}
            </h3>
            {saved && (
              <span className="rounded-full bg-emerald-100 text-emerald-800 px-2 py-0.5 text-[11px] font-medium animate-pulse">
                ✓ Saved
              </span>
            )}
            <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-700">
              <span className="font-semibold">
                {CONFIG_FIELD_TYPE_ICON[field.field_type]}
              </span>
              {CONFIG_FIELD_TYPE_LABEL[field.field_type]}
            </span>
            {field.required && (
              <span className="rounded-full bg-red-50 text-red-700 px-2 py-0.5 text-[11px] font-medium">
                Required
              </span>
            )}
            {!field.active && (
              <span className="rounded-full bg-neutral-200 text-neutral-700 px-2 py-0.5 text-[11px] font-medium">
                Inactive
              </span>
            )}
            {field.field_type === "dropdown" && field.allow_custom_value && (
              <span className="rounded-full bg-emerald-50 text-emerald-800 px-2 py-0.5 text-[11px] font-medium">
                Custom values
              </span>
            )}
            {/* Responsibility */}
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                (field.field_scope ?? "sales") === "technical"
                  ? "bg-amber-50 text-amber-800"
                  : (field.field_scope ?? "sales") === "both"
                    ? "bg-purple-50 text-purple-800"
                    : "bg-sky-50 text-sky-800"
              }`}
            >
              {(field.field_scope ?? "sales") === "technical"
                ? "Technical"
                : (field.field_scope ?? "sales") === "both"
                  ? "Both"
                  : "Sales"}
            </span>
            {/* Access level */}
            {(field.access_level === "internal" || (field.internal_only && !field.access_level)) && (
              <span className="rounded-full bg-amber-50 text-amber-800 px-2 py-0.5 text-[11px] font-medium">
                Internal only
              </span>
            )}
            {field.access_level === "admin" && (
              <span className="rounded-full bg-rose-50 text-rose-700 px-2 py-0.5 text-[11px] font-medium">
                Admin only
              </span>
            )}
            {/* Required flags */}
            {(field as any).required_for_production && (
              <span className="rounded-full bg-indigo-50 text-indigo-700 px-2 py-0.5 text-[11px] font-medium">
                Req. production
              </span>
            )}
          </div>
          <div className="text-[11px] text-neutral-500 mt-1 flex flex-wrap gap-x-3">
            <span>
              {field.visible_in_quotation ? "✓ Quotation" : "× Quotation"}
            </span>
            <span>
              {field.visible_in_task_list ? "✓ Task list" : "× Task list"}
            </span>
            <span>Order: {field.field_order}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* Duplicate field — a separate form so it never collides with the
              edit form below, and uses the same formAction pattern the file
              already relies on for the delete button. */}
          <form action={duplicateConfigField} className="inline">
            <input type="hidden" name="id" value={field.id} />
            <input type="hidden" name="category_id" value={categoryId} />
            <button
              type="submit"
              disabled={pending}
              className="btn-secondary text-sm"
              title="Create a copy of this field (with all options) at the end of the list"
            >
              Duplicate
            </button>
          </form>
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="btn-secondary text-sm"
          >
            {editing ? "Cancel" : "Edit"}
          </button>
        </div>
      </div>

      {/* Options panel — shown for dropdown AND checkbox_group */}
      {(field.field_type === "dropdown" || field.field_type === "checkbox_group") && (
        <div className="rounded-md border border-neutral-200 bg-neutral-50/60 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-neutral-700">
              Options ({options.length})
            </div>
          </div>
          {options.length === 0 ? (
            <p className="text-xs text-neutral-500">
              No options yet — add at least one so sales users have something to
              pick.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {options.map((o) => (
                <form
                  key={o.id}
                  action={deleteFieldOption}
                  className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-xs"
                >
                  <input type="hidden" name="id" value={o.id} />
                  <input type="hidden" name="category_id" value={categoryId} />
                  <span>{o.option_value}</span>
                  <button
                    type="submit"
                    className="text-neutral-400 hover:text-red-600 leading-none"
                    title="Remove option"
                  >
                    ×
                  </button>
                </form>
              ))}
            </div>
          )}
          <QuickAddOption />
          <details className="text-xs">
            <summary className="cursor-pointer text-neutral-500 hover:text-neutral-900">
              Paste many at once
            </summary>
            <form
              action={addFieldOptionsBulk}
              className="mt-2 space-y-2"
            >
              <input type="hidden" name="field_id" value={field.id} />
              <input type="hidden" name="category_id" value={categoryId} />
              <textarea
                name="bulk_options"
                rows={6}
                placeholder={`One option per line:\n12.8V 24Ah\n12.8V 30Ah\n25.6V 42Ah`}
                className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm font-mono leading-relaxed"
              />
              <button type="submit" className="btn-secondary text-sm">
                + Add all
              </button>
            </form>
          </details>
        </div>
      )}

      {/* Edit form (collapsed by default) */}
      {editing && (
        <form
          action={(fd) => {
            startTransition(async () => {
              await updateConfigField(fd);
              setSaved(true);
              setEditing(false);
              setTimeout(() => setSaved(false), 3000);
            });
          }}
          className="border-t border-neutral-200 pt-3 space-y-4"
        >
          <input type="hidden" name="id" value={field.id} />
          <input type="hidden" name="category_id" value={categoryId} />

          <div>
            <div className="eyebrow mb-1.5">Field type</div>
            <TypePicker
              value={fieldType}
              onChange={setFieldType}
              name="field_type"
            />
            {fieldType !== field.field_type && (
              <p className="text-[11px] text-amber-700 mt-2">
                ⚠ Changing the type may invalidate existing values on past
                quotations. Existing data isn't deleted — but the form will
                render the new control.
              </p>
            )}
          </div>

          {/* ── FIELD RESPONSIBILITY ── */}
          <div>
            <div className="eyebrow mb-1.5">Field Responsibility</div>
            <p className="text-[11px] text-neutral-500 mb-2">Who fills this field?</p>
            <HiddenValue name="field_scope" value={scope} />
            <div className="flex gap-2">
              <RadioCard selected={scope === "sales"} onClick={() => setScope("sales")} label="Sales" hint="Quotation builder" color="sky" />
              <RadioCard selected={scope === "technical"} onClick={() => setScope("technical")} label="Technical" hint="Task list review" color="amber" />
              <RadioCard selected={scope === "both"} onClick={() => setScope("both")} label="Both" hint="Editable everywhere" />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block">
              <div className="eyebrow mb-1">Field label</div>
              <input
                name="field_name"
                defaultValue={field.field_name}
                required
                className="w-full rounded-md border border-neutral-200 px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <div className="eyebrow mb-1">
                {fieldType === "checkbox"
                  ? "Checkbox label"
                  : "Placeholder / hint"}
              </div>
              <input
                name="placeholder"
                defaultValue={field.placeholder ?? ""}
                className="w-full rounded-md border border-neutral-200 px-3 py-2 text-sm"
              />
            </label>
          </div>

          {fieldType !== "checkbox" && (
            <label className="block">
              <div className="eyebrow mb-1">Default value</div>
              <input
                name="default_value"
                defaultValue={field.default_value ?? ""}
                className="w-full rounded-md border border-neutral-200 px-3 py-2 text-sm"
              />
            </label>
          )}

          {/* ── REQUIRED RULES ── */}
          <div>
            <div className="eyebrow mb-1.5">Required Rules</div>
            <p className="text-[11px] text-neutral-500 mb-2">Required before:</p>
            <div className="flex flex-wrap gap-2">
              <PillToggle name="required" defaultChecked={field.required} label="Quotation approval" hint="Must be filled before quotation approval." />
              <PillToggle name="required_for_production" defaultChecked={!!(field as any).required_for_production} label="Production release" hint="Must be filled before production order release." />
            </div>
          </div>

          {/* ── VISIBILITY ── */}
          <div>
            <div className="eyebrow mb-1.5">Visible In</div>
            <div className="flex flex-wrap gap-2">
              <PillToggle name="visible_in_quotation" defaultChecked={field.visible_in_quotation} label="Quotation Builder" />
              <PillToggle name="visible_in_task_list" defaultChecked={field.visible_in_task_list} label="Task List" />
              <PillToggle name="visible_in_factory" defaultChecked={(field as any).visible_in_factory !== false} label="Factory View" />
            </div>
          </div>

          {/* ── ACCESS LEVEL ── */}
          <div>
            <div className="eyebrow mb-1.5">Access Level</div>
            <HiddenValue name="access_level" value={access} />
            <div className="flex gap-2">
              <RadioCard selected={access === "everyone"} onClick={() => setAccess("everyone")} label="Everyone" hint="All roles, visible in PDF" />
              <RadioCard selected={access === "internal"} onClick={() => setAccess("internal")} label="Internal only" hint="Hidden from customer PDF" color="amber" />
              <RadioCard selected={access === "admin"} onClick={() => setAccess("admin")} label="Admin only" hint="Admin + super admin only" color="rose" />
            </div>
          </div>

          {/* ── FIELD SETTINGS ── */}
          <div>
            <div className="eyebrow mb-1.5">Field Settings</div>
            <div className="flex flex-wrap gap-2">
              <PillToggle name="active" defaultChecked={field.active} label="Active" />
              {(fieldType === "dropdown" || fieldType === "checkbox_group") && (
                <PillToggle name="allow_custom_value" defaultChecked={!!field.allow_custom_value} label="Allow custom values" />
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3">
            <label className="block">
              <div className="eyebrow mb-1">Display order</div>
              <input
                name="field_order"
                type="number"
                defaultValue={field.field_order}
                className="w-full md:w-32 rounded-md border border-neutral-200 px-3 py-2 text-sm tabular-nums"
              />
            </label>
          </div>

          <div className="flex items-center justify-between border-t border-neutral-100 pt-3">
            {/*
              IMPORTANT: HTML doesn't allow nested <form> elements. Instead of
              a nested form, we use the `formAction` attribute on the delete
              button to override the parent form's action just for this click.
              The hidden inputs above (id, category_id) are still submitted —
              field_type / field_name etc. are ignored by deleteConfigField.
            */}
            <button
              type="submit"
              formAction={deleteConfigField}
              className="text-xs text-red-600 hover:underline"
              // No client-side confirm — keep operations fast as requested.
            >
              Delete field
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button type="submit" disabled={pending} className="btn-primary">
                {pending ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
