"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createClientAction } from "./actions";
import CustomFieldsEditor from "./[id]/edit/CustomFieldsEditor";
import { CountrySelect } from "@/components/forms/CountrySelect";
import { PhoneField } from "@/components/forms/PhoneField";
import { dialForCountry } from "@/lib/countries";

/**
 * "+ New client" — trigger button + focused creation modal.
 *
 * Two entry points open the SAME modal:
 *   1. the "+ New client" button in the Clients page header, and
 *   2. the "New client" item in the Clients & Business mega menu, which
 *      deep-links to `/clients?new=1`; this component opens on that param and
 *      strips it on close so refresh/back never re-triggers it.
 *
 * Layout is a wide (≈900px) B2B/CRM card split into three labelled sections —
 * Company / Contact / Administrative — with a fixed header, a scrollable body,
 * and a sticky footer. Field names are unchanged, so the server action and DB
 * mapping are identical to before.
 */
export default function NewClientPanel() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [open, setOpen] = useState(false);
  // Phone prefix is mirrored here so picking a country can prefill it.
  const [phoneCode, setPhoneCode] = useState("");
  const modalRef = useRef<HTMLDivElement>(null);

  // Open when arriving via the mega-menu deep link (?new=1).
  useEffect(() => {
    if (searchParams.get("new")) setOpen(true);
  }, [searchParams]);

  const close = () => {
    setOpen(false);
    setPhoneCode("");
    // Drop the ?new=1 param (preserving any others) so the modal doesn't
    // re-open on refresh and the URL stays clean.
    if (searchParams.get("new")) {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("new");
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }
  };

  // While open: Escape closes, Tab is trapped inside the modal, page scroll
  // is locked.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== "Tab") return;
      const root = modalRef.current;
      if (!root) return;
      const focusables = Array.from(
        root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !root.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !root.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
    // close/searchParams are stable enough for this lifecycle; re-running only
    // on `open` keeps the listener attached for the modal's whole lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const sectionTitle =
    "text-[11px] font-semibold uppercase tracking-wide text-neutral-400";
  const fieldLabel = "block text-[12px] font-medium text-neutral-600";
  const fieldInput =
    "mt-1.5 w-full rounded-md border border-neutral-200 px-3 py-2 text-sm focus:border-solux focus:outline-none focus:ring-1 focus:ring-solux/40";
  const hint = "mt-1 block text-[11px] text-neutral-400";

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn-secondary">
        + New client
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="po-premium fixed inset-0 z-50 flex items-start justify-center bg-neutral-900/40 p-4 sm:items-center sm:p-6"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) close();
            }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-client-title"
          >
            <div
              ref={modalRef}
              className="flex max-h-[calc(100dvh-2rem)] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-xl ring-1 ring-black/5 sm:max-h-[calc(100dvh-4rem)]"
            >
              {/* Header — fixed */}
              <div className="flex shrink-0 items-start justify-between gap-3 border-b border-neutral-100 px-6 py-4">
                <div className="min-w-0">
                  <h3 id="new-client-title" className="text-base font-semibold text-neutral-900">
                    New client
                  </h3>
                  <p className="text-[12px] text-neutral-400">
                    Add a company to your client directory.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={close}
                  aria-label="Close"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                >
                  ✕
                </button>
              </div>

              <form
                action={async (fd) => {
                  await createClientAction(fd);
                  close();
                }}
                className="flex min-h-0 flex-1 flex-col"
              >
                {/* Body — scrolls between the fixed header and sticky footer */}
                <div className="min-h-0 flex-1 space-y-7 overflow-y-auto px-6 py-5">
                  {/* COMPANY */}
                  <section className="space-y-3">
                    <h4 className={sectionTitle}>Company</h4>
                    <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-3">
                      <label className="block sm:col-span-1">
                        <span className={fieldLabel}>Company name *</span>
                        <input
                          name="company_name"
                          placeholder="Arelux Lighting"
                          required
                          autoFocus
                          className={fieldInput}
                        />
                      </label>
                      <label className="block sm:col-span-1">
                        <span className={fieldLabel}>Client code</span>
                        <input
                          name="client_code"
                          placeholder="ARL"
                          maxLength={3}
                          className={`${fieldInput} font-mono uppercase`}
                          style={{ textTransform: "uppercase" }}
                        />
                        <span className={hint}>
                          3 letters — shown in document numbers, e.g.{" "}
                          <code>SLX-ARL-26-001</code>.
                        </span>
                      </label>
                      <label className="block sm:col-span-1">
                        <span className={fieldLabel}>Country</span>
                        <CountrySelect
                          name="country"
                          className="mt-1.5"
                          onSelect={(country) => {
                            const dial = dialForCountry(country);
                            if (dial && !phoneCode) setPhoneCode(dial);
                          }}
                        />
                      </label>
                    </div>
                  </section>

                  {/* CONTACT */}
                  <section className="space-y-3">
                    <h4 className={sectionTitle}>Contact</h4>
                    <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-3">
                      <label className="block sm:col-span-1">
                        <span className={fieldLabel}>Contact person</span>
                        <input name="contact_name" placeholder="Full name" className={fieldInput} />
                      </label>
                      <label className="block sm:col-span-1">
                        <span className={fieldLabel}>Email</span>
                        <input
                          name="email"
                          type="email"
                          placeholder="contact@company.com"
                          className={fieldInput}
                        />
                      </label>
                      <label className="block sm:col-span-1">
                        <span className={fieldLabel}>Phone number</span>
                        <PhoneField
                          phoneCodeName="phone_country_code"
                          phoneNumberName="phone_number"
                          defaultCode={phoneCode}
                          key={phoneCode || "nophone"}
                          className="mt-1.5"
                        />
                      </label>
                    </div>
                  </section>

                  {/* ADMINISTRATIVE */}
                  <section className="space-y-3">
                    <h4 className={sectionTitle}>Administrative</h4>
                    <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-3">
                      <label className="block sm:col-span-3">
                        <span className={fieldLabel}>Full address</span>
                        <textarea
                          name="address"
                          rows={3}
                          placeholder={"123 Industrial Way\nLondon, EC1A 1BB\nUnited Kingdom"}
                          className={`${fieldInput} resize-y`}
                        />
                      </label>
                      <label className="block sm:col-span-1">
                        <span className={fieldLabel}>VAT / Tax number</span>
                        <input
                          name="vat_number"
                          placeholder="GB287451982"
                          className={`${fieldInput} font-mono`}
                        />
                      </label>
                      <label className="block sm:col-span-1">
                        <span className={fieldLabel}>Attention line</span>
                        <input
                          name="default_attention_to"
                          placeholder="Purchasing Department"
                          className={fieldInput}
                        />
                      </label>
                      <label className="block sm:col-span-1">
                        <span className={fieldLabel}>Previous orders before SOLUX</span>
                        <input
                          name="starting_sequence_number"
                          type="number"
                          min={0}
                          placeholder="0"
                          className={fieldInput}
                        />
                        <span className={hint}>
                          Orders placed before SOLUX — your next quote continues at N + 1.
                        </span>
                      </label>
                    </div>

                    {/* Optional custom tax / registration fields — same
                        "+ Add field" editor used on the client edit page. */}
                    <div className="border-t border-neutral-100 pt-4">
                      <CustomFieldsEditor initial={[]} />
                    </div>
                  </section>
                </div>

                {/* Footer — sticky actions */}
                <div className="flex shrink-0 items-center justify-between gap-3 border-t border-neutral-100 bg-neutral-50/70 px-6 py-3.5">
                  <p className="hidden text-[11px] text-neutral-400 sm:block">
                    <span className="text-rose-500">*</span> Required field
                  </p>
                  <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
                    <button
                      type="button"
                      onClick={close}
                      className="rounded-md px-3.5 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-100"
                    >
                      Cancel
                    </button>
                    <button className="btn-primary px-5">Add client</button>
                  </div>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
