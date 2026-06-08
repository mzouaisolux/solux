"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateClientBlProfile } from "@/app/(app)/clients/actions";
import {
  normalizeBlProfile,
  type BlProfile,
  type BlDocument,
} from "@/lib/bl";

/**
 * ClientBlEditor — the reusable Shipping / BL profile editor on a
 * client.
 *
 * Sections:
 *   - Shipper      (Solux defaults, editable)
 *   - Consignee    ("Same as client" prefill, still editable)
 *   - Notify party ("Same as consignee" prefill, still editable)
 *   - Documents    (catalog checklist + optional cost + custom rows)
 *   - Notes        (free manual space)
 *
 * Saves the whole profile as one JSON blob via a server action.
 */

/** The client's own fields, used to prefill "Same as client". */
export type ClientPrefill = {
  company_name: string | null;
  address: string | null;
  country: string | null;
  contact_name: string | null;
  phone: string | null; // already combined "+229 12345678"
  email: string | null;
  tax_id: string | null;
};

export function ClientBlEditor({
  clientId,
  initialProfile,
  clientPrefill,
  defaultCurrency = "USD",
}: {
  clientId: string;
  initialProfile: unknown;
  clientPrefill: ClientPrefill;
  defaultCurrency?: string;
}) {
  const router = useRouter();
  const [profile, setProfile] = useState<BlProfile>(() =>
    normalizeBlProfile(initialProfile, defaultCurrency)
  );
  const [saving, startTransition] = useTransition();
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  /* ---- field helpers ---- */
  const setShipper = (patch: Partial<BlProfile["shipper"]>) =>
    setProfile((p) => ({ ...p, shipper: { ...p.shipper, ...patch } }));
  const setConsignee = (patch: Partial<BlProfile["consignee"]>) =>
    setProfile((p) => ({ ...p, consignee: { ...p.consignee, ...patch } }));
  const setNotify = (patch: Partial<BlProfile["notify"]>) =>
    setProfile((p) => ({ ...p, notify: { ...p.notify, ...patch } }));

  const onSameAsClient = (checked: boolean) => {
    setProfile((p) => ({
      ...p,
      consignee: {
        ...p.consignee,
        same_as_client: checked,
        ...(checked
          ? {
              company_name: clientPrefill.company_name,
              address: clientPrefill.address,
              country: clientPrefill.country,
              contact_person: clientPrefill.contact_name,
              phone: clientPrefill.phone,
              email: clientPrefill.email,
              tax_id: clientPrefill.tax_id,
            }
          : {}),
      },
    }));
  };

  const onSameAsConsignee = (checked: boolean) => {
    setProfile((p) => ({
      ...p,
      notify: {
        ...p.notify,
        same_as_consignee: checked,
        ...(checked
          ? {
              company_name: p.consignee.company_name,
              address: p.consignee.address,
              country: p.consignee.country,
              contact_person: p.consignee.contact_person,
              phone: p.consignee.phone,
              email: p.consignee.email,
            }
          : {}),
      },
    }));
  };

  const setDoc = (key: string, patch: Partial<BlDocument>) =>
    setProfile((p) => ({
      ...p,
      documents: p.documents.map((d) =>
        d.key === key ? { ...d, ...patch } : d
      ),
    }));

  const addCustomDoc = () =>
    setProfile((p) => ({
      ...p,
      documents: [
        ...p.documents,
        {
          key: `custom_${Date.now()}`,
          label: "",
          included: true,
          cost: null,
          currency: defaultCurrency,
          custom: true,
        },
      ],
    }));

  const removeDoc = (key: string) =>
    setProfile((p) => ({
      ...p,
      documents: p.documents.filter((d) => d.key !== key),
    }));

  const save = () => {
    setError(null);
    const fd = new FormData();
    fd.set("id", clientId);
    fd.set("bl_profile", JSON.stringify(profile));
    startTransition(async () => {
      try {
        await updateClientBlProfile(fd);
        setSavedAt(Date.now());
        router.refresh();
      } catch (e: any) {
        setError(e?.message ?? "Failed to save BL profile");
      }
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="eyebrow">Shipping / BL profile</div>
          <p className="text-xs text-neutral-500 mt-1 max-w-xl">
            Reusable Bill-of-Lading template for this client — parties +
            the export documents their shipments require. Saved here, it
            seeds future shipments.
          </p>
        </div>
        {savedAt && !saving && (
          <span className="text-[11px] text-emerald-700">Saved</span>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700">
          {error}
        </div>
      )}

      {/* Shipper */}
      <Party
        title="Shipper"
        hint="Defaults to the exporter — editable per client."
        fields={profile.shipper}
        onChange={(patch) => setShipper(patch)}
      />

      {/* Consignee */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
            Consignee
          </span>
          <label className="inline-flex items-center gap-1.5 text-[11px] text-neutral-600 cursor-pointer">
            <input
              type="checkbox"
              checked={profile.consignee.same_as_client}
              onChange={(e) => onSameAsClient(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-neutral-300"
            />
            Same as client (prefill, editable)
          </label>
        </div>
        <PartyFields
          fields={profile.consignee}
          onChange={(patch) => setConsignee(patch)}
          extra={
            <>
              <label className="block">
                <span className="text-[10px] text-neutral-500">Country</span>
                <input
                  value={profile.consignee.country ?? ""}
                  onChange={(e) => setConsignee({ country: e.target.value })}
                  className="mt-0.5 w-full rounded border border-neutral-200 px-2.5 py-1.5 text-sm"
                />
              </label>
              <label className="block">
                <span className="text-[10px] text-neutral-500">
                  Tax ID / VAT number
                </span>
                <input
                  value={profile.consignee.tax_id ?? ""}
                  onChange={(e) => setConsignee({ tax_id: e.target.value })}
                  className="mt-0.5 w-full rounded border border-neutral-200 px-2.5 py-1.5 text-sm font-mono"
                />
              </label>
            </>
          }
        />
      </div>

      {/* Notify party */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
            Notify party
          </span>
          <label className="inline-flex items-center gap-1.5 text-[11px] text-neutral-600 cursor-pointer">
            <input
              type="checkbox"
              checked={profile.notify.same_as_consignee}
              onChange={(e) => onSameAsConsignee(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-neutral-300"
            />
            Same as consignee
          </label>
        </div>
        {!profile.notify.same_as_consignee && (
          <PartyFields
            fields={profile.notify}
            onChange={(patch) => setNotify(patch)}
            extra={
              <label className="block">
                <span className="text-[10px] text-neutral-500">Country</span>
                <input
                  value={profile.notify.country ?? ""}
                  onChange={(e) => setNotify({ country: e.target.value })}
                  className="mt-0.5 w-full rounded border border-neutral-200 px-2.5 py-1.5 text-sm"
                />
              </label>
            }
          />
        )}
      </div>

      {/* Documents */}
      <div className="space-y-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
          Export documents
        </span>
        <p className="text-[11px] text-neutral-500">
          Tick what this client requires. Add an optional cost where the
          document is billable.
        </p>
        <ul className="divide-y divide-neutral-100 rounded-md border border-neutral-200">
          {profile.documents.map((d) => (
            <li
              key={d.key}
              className="flex items-center gap-3 px-3 py-2"
            >
              <label className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer">
                <input
                  type="checkbox"
                  checked={d.included}
                  onChange={(e) => setDoc(d.key, { included: e.target.checked })}
                  className="h-4 w-4 rounded border-neutral-300 shrink-0"
                />
                {d.custom ? (
                  <input
                    value={d.label}
                    placeholder="Document name"
                    onChange={(e) => setDoc(d.key, { label: e.target.value })}
                    className="flex-1 min-w-0 rounded border border-neutral-200 px-2 py-1 text-sm"
                  />
                ) : (
                  <span className="text-sm text-neutral-800 truncate">
                    {d.label}
                  </span>
                )}
              </label>

              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[10px] text-neutral-400">Cost</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  value={d.cost ?? ""}
                  disabled={!d.included}
                  placeholder="—"
                  onChange={(e) =>
                    setDoc(d.key, {
                      cost: e.target.value ? parseFloat(e.target.value) : null,
                    })
                  }
                  className="w-24 rounded border border-neutral-200 px-2 py-1 text-sm tabular-nums disabled:bg-neutral-50 disabled:text-neutral-400"
                />
                <select
                  value={d.currency}
                  disabled={!d.included}
                  onChange={(e) => setDoc(d.key, { currency: e.target.value })}
                  className="rounded border border-neutral-200 px-1.5 py-1 text-xs bg-white disabled:bg-neutral-50 disabled:text-neutral-400"
                >
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="CNY">CNY</option>
                </select>
                {d.custom && (
                  <button
                    type="button"
                    onClick={() => removeDoc(d.key)}
                    className="text-neutral-400 hover:text-rose-600 text-xs px-1"
                    aria-label="Remove document"
                  >
                    ✕
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={addCustomDoc}
          className="text-[11px] text-neutral-600 hover:text-neutral-900 underline underline-offset-2"
        >
          + Add another document
        </button>
      </div>

      {/* Notes */}
      <label className="block">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
          Notes
        </span>
        <textarea
          value={profile.notes ?? ""}
          rows={2}
          placeholder="Anything else the freight forwarder / customs needs to know…"
          onChange={(e) =>
            setProfile((p) => ({ ...p, notes: e.target.value || null }))
          }
          className="mt-1 w-full rounded border border-neutral-200 px-3 py-2 text-sm"
        />
      </label>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded bg-solux px-4 py-2 text-white text-sm font-medium hover:bg-solux-dark disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save BL profile"}
        </button>
      </div>
    </div>
  );
}

/* ============================================================
   Sub-components
   ============================================================ */

type PartyShape = {
  company_name: string | null;
  address: string | null;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
};

function Party({
  title,
  hint,
  fields,
  onChange,
}: {
  title: string;
  hint?: string;
  fields: PartyShape;
  onChange: (patch: Partial<PartyShape>) => void;
}) {
  return (
    <div className="space-y-2">
      <div>
        <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
          {title}
        </span>
        {hint && <p className="text-[11px] text-neutral-500">{hint}</p>}
      </div>
      <PartyFields fields={fields} onChange={onChange} />
    </div>
  );
}

function PartyFields({
  fields,
  onChange,
  extra,
}: {
  fields: PartyShape;
  onChange: (patch: Partial<PartyShape>) => void;
  extra?: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
      <label className="block">
        <span className="text-[10px] text-neutral-500">Company name</span>
        <input
          value={fields.company_name ?? ""}
          onChange={(e) => onChange({ company_name: e.target.value })}
          className="mt-0.5 w-full rounded border border-neutral-200 px-2.5 py-1.5 text-sm"
        />
      </label>
      <label className="block">
        <span className="text-[10px] text-neutral-500">Contact person</span>
        <input
          value={fields.contact_person ?? ""}
          onChange={(e) => onChange({ contact_person: e.target.value })}
          className="mt-0.5 w-full rounded border border-neutral-200 px-2.5 py-1.5 text-sm"
        />
      </label>
      <label className="block md:col-span-2">
        <span className="text-[10px] text-neutral-500">Address</span>
        <textarea
          value={fields.address ?? ""}
          rows={2}
          onChange={(e) => onChange({ address: e.target.value })}
          className="mt-0.5 w-full rounded border border-neutral-200 px-2.5 py-1.5 text-sm"
        />
      </label>
      <label className="block">
        <span className="text-[10px] text-neutral-500">Phone</span>
        <input
          value={fields.phone ?? ""}
          onChange={(e) => onChange({ phone: e.target.value })}
          className="mt-0.5 w-full rounded border border-neutral-200 px-2.5 py-1.5 text-sm"
        />
      </label>
      <label className="block">
        <span className="text-[10px] text-neutral-500">Email</span>
        <input
          type="email"
          value={fields.email ?? ""}
          onChange={(e) => onChange({ email: e.target.value })}
          className="mt-0.5 w-full rounded border border-neutral-200 px-2.5 py-1.5 text-sm"
        />
      </label>
      {extra}
    </div>
  );
}
