"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createClientAction, suggestClientCodeAction } from "./actions";
import CustomFieldsEditor from "./[id]/edit/CustomFieldsEditor";
import { CountrySelect } from "@/components/forms/CountrySelect";
import { PhoneField } from "@/components/forms/PhoneField";
import { dialForCountry } from "@/lib/countries";
import {
  deriveClientCodeBase,
  isValidClientCode,
  normalizeClientCode,
} from "@/lib/client-code";

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
export default function NewClientPanel({
  trigger,
  deepLink = true,
}: {
  /** Optional custom trigger (CRM cards skin) — receives the open() callback.
   *  Defaults to the classic "+ New client" secondary button. */
  trigger?: (open: () => void) => React.ReactNode;
  /** Only ONE instance per page should react to ?new=1 — when the panel is
   *  mounted twice (header + "add" card) the second sets this to false so
   *  the deep link doesn't open two stacked modals. */
  deepLink?: boolean;
} = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [open, setOpen] = useState(false);
  // Phone prefix is mirrored here so picking a country can prefill it.
  const [phoneCode, setPhoneCode] = useState("");
  const [companyName, setCompanyName] = useState("");
  // The 3-letter code is AUTO-GENERATED from the name and kept in sync until
  // the rep overrides it (codeManual). `availability` reflects the live,
  // cross-rep check; `suggestion` is the nearest free code to offer.
  const [clientCode, setClientCode] = useState("");
  const [codeManual, setCodeManual] = useState(false);
  const [codeTouched, setCodeTouched] = useState(false);
  const [availability, setAvailability] = useState<
    "idle" | "checking" | "available" | "taken"
  >("idle");
  const [suggestion, setSuggestion] = useState("");
  // Empty is OK (the server auto-generates one); only a present-but-malformed
  // code blocks submit. No digits/symbols — mirrors the DB CHECK ^[A-Z]{3}$.
  const codeError =
    clientCode.length === 0 || /^[A-Za-z]{3}$/.test(clientCode)
      ? null
      : "3 letters only — no digits or symbols (e.g. ARL)";
  const canSubmit = companyName.trim().length > 0 && codeError === null;
  // Inline validation error returned by createClientAction (e.g. duplicate
  // client code) — shown in the footer; the form + its data are preserved.
  const [formError, setFormError] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // Open when arriving via the mega-menu deep link (?new=1).
  useEffect(() => {
    if (deepLink && searchParams.get("new")) setOpen(true);
  }, [searchParams]);

  // Auto-derive the code from the name (instant, local) until the rep edits it.
  useEffect(() => {
    if (codeManual) return;
    const base = deriveClientCodeBase(companyName);
    setClientCode((prev) => (prev === base ? prev : base));
  }, [companyName, codeManual]);

  // Live availability — debounced, cross-rep accurate (server action). In AUTO
  // mode, silently adopt the nearest FREE code so the rep never has to think
  // about it; in MANUAL mode, just report available/taken + offer the suggestion.
  useEffect(() => {
    if (!open) return;
    const name = companyName.trim();
    const code = normalizeClientCode(clientCode);
    if (!name && !code) {
      setAvailability("idle");
      setSuggestion("");
      return;
    }
    setAvailability("checking");
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const res = await suggestClientCodeAction(name, code);
        if (cancelled) return;
        setSuggestion(res.suggestion);
        if (isValidClientCode(code)) {
          const free = res.preferredAvailable === true;
          setAvailability(free ? "available" : "taken");
          if (!codeManual && !free && res.suggestion && res.suggestion !== code) {
            setClientCode(res.suggestion); // auto mode: roll to the free code
          }
        } else {
          setAvailability("idle");
          if (!codeManual && res.suggestion && res.suggestion !== code) {
            setClientCode(res.suggestion);
          }
        }
      } catch {
        if (!cancelled) setAvailability("idle");
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [clientCode, companyName, codeManual, open]);

  const close = () => {
    setOpen(false);
    setPhoneCode("");
    setFormError(null);
    setCompanyName("");
    setClientCode("");
    setCodeManual(false);
    setAvailability("idle");
    setSuggestion("");
    setCodeTouched(false);
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
      {trigger ? (
        trigger(() => setOpen(true))
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="btn-secondary">
          + New client
        </button>
      )}

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
                  // On SUCCESS createClientAction redirects SERVER-SIDE (throws
                  // NEXT_REDIRECT, which we must let propagate so Next navigates;
                  // the modal unmounts on navigate). On a VALIDATION failure
                  // (e.g. a duplicate client code) it RETURNS { error } instead
                  // of throwing — show it inline and keep the form so the user
                  // never loses what they typed.
                  setFormError(null);
                  const res = await createClientAction(fd);
                  if (res && "error" in res && res.error) setFormError(res.error);
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
                          value={companyName}
                          onChange={(e) => setCompanyName(e.target.value)}
                          className={fieldInput}
                        />
                      </label>
                      <label className="block sm:col-span-1">
                        <span className={fieldLabel}>Client code</span>
                        <input
                          name="client_code"
                          placeholder="Auto"
                          maxLength={3}
                          title="Auto-generated from the name — 3 letters (e.g. ARL). Edit only to force a specific one."
                          value={clientCode}
                          onChange={(e) => {
                            setCodeManual(true);
                            setClientCode(e.target.value.toUpperCase());
                          }}
                          onBlur={() => setCodeTouched(true)}
                          aria-invalid={
                            (codeTouched && !!codeError) || availability === "taken"
                          }
                          className={`${fieldInput} font-mono uppercase ${
                            (codeTouched && codeError) || availability === "taken"
                              ? "border-rose-400 focus:border-rose-500 focus:ring-rose-200"
                              : availability === "available"
                                ? "border-emerald-400 focus:border-emerald-500 focus:ring-emerald-200"
                                : ""
                          }`}
                          style={{ textTransform: "uppercase" }}
                        />
                        {codeTouched && codeError ? (
                          <span className="mt-1 block text-[11px] font-medium text-rose-600">
                            {codeError}
                          </span>
                        ) : availability === "checking" ? (
                          <span className={hint}>Checking availability…</span>
                        ) : availability === "available" && clientCode ? (
                          <span className="mt-1 block text-[11px] font-medium text-emerald-600">
                            ✓ {clientCode} is available
                          </span>
                        ) : availability === "taken" ? (
                          <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] font-medium text-rose-600">
                            {clientCode} is already taken
                            {suggestion && suggestion !== clientCode && (
                              <button
                                type="button"
                                onClick={() => {
                                  setClientCode(suggestion);
                                  setCodeManual(true);
                                }}
                                className="rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-700 hover:bg-emerald-100"
                              >
                                Use {suggestion}
                              </button>
                            )}
                          </span>
                        ) : (
                          <span className={hint}>
                            Auto-generated from the name — appears in every
                            document number, e.g. <code>SLX-ARL-26-001</code>.
                            Edit only to force a specific one.
                          </span>
                        )}
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

                {/* Inline error (e.g. duplicate client code) — preserves the form */}
                {formError && (
                  <div
                    role="alert"
                    className="shrink-0 border-t border-rose-200 bg-rose-50 px-6 py-2.5 text-sm text-rose-700"
                  >
                    {formError}
                  </div>
                )}

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
                    <button
                      type="submit"
                      disabled={!canSubmit}
                      onClick={() => setCodeTouched(true)}
                      title={
                        canSubmit
                          ? "Create this client"
                          : codeError
                            ? `Client code: ${codeError}`
                            : "Fill the required fields"
                      }
                      className="btn-primary px-5 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Add client
                    </button>
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
