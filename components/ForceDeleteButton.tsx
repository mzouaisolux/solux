"use client";

// =====================================================================
// SUPER-ADMIN FORCE DELETE (m169) — red "Delete Permanently" button with a
// TWO-STEP confirmation:
//   step 1 — "Delete permanently? This action cannot be undone."
//   step 2 — "…contains related data. Everything will be permanently
//             deleted. Type DELETE to continue." (button disabled until the
//             user literally types DELETE)
// Rendered ONLY for super-admins (server-side gate on the page) and enforced
// again inside the server action AND inside the SECURITY DEFINER RPC.
// Deliberately a standalone red control — never mixed into the regular
// actions menu, so it cannot be clicked by habit.
// =====================================================================

import { useState, useTransition } from "react";
import { toast } from "@/components/feedback/toast-store";

export default function ForceDeleteButton({
  action,
  id,
  entity, // "client" | "project"
  entityLabel, // e.g. "ACME (ACM)" or the affair name
}: {
  action: (formData: FormData) => Promise<void>;
  id: string;
  entity: "client" | "project";
  entityLabel: string;
}) {
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [typed, setTyped] = useState("");
  const [pending, startTransition] = useTransition();
  const armed = typed.trim() === "DELETE";

  function close() {
    setStep(0);
    setTyped("");
  }

  function run() {
    if (!armed || pending) return;
    const fd = new FormData();
    fd.set("id", id);
    startTransition(async () => {
      try {
        await action(fd);
        // On success the action redirects server-side (NEXT_REDIRECT throws
        // past this line) — nothing else to do here.
      } catch (e: any) {
        const msg = String(e?.message ?? e);
        // Next's redirect signal is not an error.
        if (msg.includes("NEXT_REDIRECT")) return;
        toast.error(msg || "Force delete failed.");
        close();
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setStep(1)}
        className="inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-[12.5px] font-semibold text-red-700 transition hover:bg-red-600 hover:text-white"
        title="Super-admin only — permanently deletes this record and ALL related data"
      >
        {/* trash icon */}
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5" aria-hidden>
          <path
            fillRule="evenodd"
            d="M8.75 1a2 2 0 0 0-2 2v.5H4a.75.75 0 0 0 0 1.5h.5v11A2 2 0 0 0 6.5 18h7a2 2 0 0 0 2-2V5h.5a.75.75 0 0 0 0-1.5h-2.75V3a2 2 0 0 0-2-2h-2.5ZM8.25 3a.5.5 0 0 1 .5-.5h2.5a.5.5 0 0 1 .5.5v.5h-3.5V3ZM7.5 7.75a.75.75 0 0 1 1.5 0v6.5a.75.75 0 0 1-1.5 0v-6.5Zm4.25-.75a.75.75 0 0 0-.75.75v6.5a.75.75 0 0 0 1.5 0v-6.5a.75.75 0 0 0-.75-.75Z"
            clipRule="evenodd"
          />
        </svg>
        Delete Permanently
      </button>

      {step > 0 && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-xl border border-red-200 bg-white p-5 shadow-xl">
            {step === 1 ? (
              <>
                <h3 className="text-[15px] font-bold text-red-700">Delete permanently?</h3>
                <p className="mt-2 text-sm text-neutral-700">
                  This action <b>cannot be undone</b>.
                </p>
                <p className="mt-1 text-[12.5px] text-neutral-500 break-words">
                  {entity === "client" ? "Client" : "Project"}: <b>{entityLabel}</b>
                </p>
                <div className="mt-4 flex justify-end gap-2">
                  <button type="button" onClick={close} className="rounded-md border border-neutral-200 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50">
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => setStep(2)}
                    className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700"
                  >
                    Continue
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-[15px] font-bold text-red-700">
                  This {entity} contains related data.
                </h3>
                <p className="mt-2 text-sm text-neutral-700">
                  Quotations, invoices, service requests, production data, documents, comments and
                  audit history linked to this {entity} will be <b>permanently deleted</b>. Nothing
                  will remain.
                </p>
                <label className="mt-4 block text-[12.5px] font-medium text-neutral-600">
                  Type <span className="font-mono font-bold text-red-700">DELETE</span> to continue
                  <input
                    autoFocus
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    placeholder="DELETE"
                    className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 font-mono text-sm tracking-widest focus:border-red-400 focus:outline-none"
                  />
                </label>
                <div className="mt-4 flex justify-end gap-2">
                  <button type="button" onClick={close} className="rounded-md border border-neutral-200 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50">
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={run}
                    disabled={!armed || pending}
                    className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {pending ? "Deleting…" : "Delete"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
