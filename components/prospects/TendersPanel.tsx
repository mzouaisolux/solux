"use client";

// =====================================================================
// Tenders panel (CRM sandbox, m104) — raw calls for tenders. The same
// object behaves in two OPPOSITE ways (PLAN_CRM_SOLUX §7):
//   • OPEN   — to defend: attach to a company (client or prospect = the
//     bidding partner) → "Convert to affair" (source = tender).
//   • RESULT — already awarded: competitor intel. Participants (winner,
//     bid, reasons) are promotable to prospects in one click.
// =====================================================================

import { useState } from "react";
import Link from "next/link";
import {
  createTender,
  attachTender,
  convertTenderToAffair,
  closeTender,
  deleteTender,
  addTenderParticipant,
  deleteTenderParticipant,
  promoteParticipantToProspect,
} from "@/app/(app)/prospects/actions";
import { toast } from "@/components/feedback/toast-store";

export type ParticipantRow = {
  id: string;
  tender_id: string;
  company_name: string;
  country: string | null;
  is_winner: boolean;
  bid_value: number | null;
  notes: string | null;
  promoted_prospect_id: string | null;
};

export type TenderRow = {
  id: string;
  title: string;
  reference: string | null;
  country: string | null;
  type: "open" | "result";
  value: number | null;
  deadline: string | null;
  notes: string | null;
  status: string;
  attached_client_id: string | null;
  attached_prospect_id: string | null;
  converted_affair_id: string | null;
  /** resolved server-side for display */
  attachedName: string | null;
  participants: ParticipantRow[];
};

export type CompanyOption = { id: string; name: string };

const money = (n: number | null) =>
  n == null ? null : `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

function isNavError(e: any): boolean {
  const d = e?.digest;
  return typeof d === "string" && (d.startsWith("NEXT_REDIRECT") || d.startsWith("NEXT_NOT_FOUND"));
}

const inputCls =
  "mt-0.5 w-full rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-200";

function AddTenderForm({ onClose }: { onClose: () => void }) {
  const [type, setType] = useState<"open" | "result">("open");
  return (
    <form
      action={async (fd) => {
        try {
          await createTender(fd);
          toast.success("Tender added");
          onClose();
        } catch (e: any) {
          toast.error(e?.message ?? "Could not add the tender.");
        }
      }}
      className="rounded-lg border border-neutral-200 bg-neutral-50/60 p-3 space-y-2"
    >
      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
        <label className="block">
          <span className="text-[11px] text-neutral-500">Type *</span>
          <select name="type" value={type} onChange={(e) => setType(e.target.value as any)} className={inputCls}>
            <option value="open">Open — to defend (we bid with a partner)</option>
            <option value="result">Result — awarded (competitor intel)</option>
          </select>
        </label>
        <label className="block md:col-span-2">
          <span className="text-[11px] text-neutral-500">Title *</span>
          <input name="title" required autoFocus placeholder="e.g. 5,000 solar street lights — Benin Ministry of Energy" className={inputCls} />
        </label>
        <label className="block">
          <span className="text-[11px] text-neutral-500">Reference</span>
          <input name="reference" className={inputCls} />
        </label>
        <label className="block">
          <span className="text-[11px] text-neutral-500">Country</span>
          <input name="country" className={inputCls} />
        </label>
        <label className="block">
          <span className="text-[11px] text-neutral-500">Value (USD)</span>
          <input name="value" type="number" min={0} step="0.01" className={inputCls} />
        </label>
        {type === "open" && (
          <label className="block">
            <span className="text-[11px] text-neutral-500">Submission deadline</span>
            <input name="deadline" type="date" className={inputCls} />
          </label>
        )}
        <label className={`block ${type === "open" ? "md:col-span-2" : "md:col-span-3"}`}>
          <span className="text-[11px] text-neutral-500">Notes</span>
          <input name="notes" className={inputCls} />
        </label>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded border border-neutral-200 px-2.5 py-1 text-[11px] text-neutral-600 hover:bg-neutral-50">
          Cancel
        </button>
        <button type="submit" className="rounded-md bg-solux px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-solux-dark">
          Add tender
        </button>
      </div>
    </form>
  );
}

function ParticipantsBlock({
  tender,
}: {
  tender: TenderRow;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="mt-2 rounded-lg border border-neutral-100 bg-neutral-50/40 p-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
          Participants — competitor intel
        </span>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded border border-neutral-300 px-2 py-0.5 text-[11px] font-semibold text-neutral-700 hover:bg-white"
          >
            + Add participant
          </button>
        )}
      </div>

      {adding && (
        <form
          action={async (fd) => {
            try {
              await addTenderParticipant(fd);
              setAdding(false);
            } catch (e: any) {
              toast.error(e?.message ?? "Could not add the participant.");
            }
          }}
          className="mt-2 flex flex-wrap items-end gap-2"
        >
          <input type="hidden" name="tender_id" value={tender.id} />
          <label className="block min-w-0 flex-1">
            <span className="block text-[10px] text-neutral-500">Company *</span>
            <input name="company_name" required className={inputCls} />
          </label>
          <label className="block w-28">
            <span className="block text-[10px] text-neutral-500">Country</span>
            <input name="country" className={inputCls} />
          </label>
          <label className="block w-32">
            <span className="block text-[10px] text-neutral-500">Bid (USD)</span>
            <input name="bid_value" type="number" min={0} step="0.01" className={inputCls} />
          </label>
          <label className="block min-w-0 flex-1">
            <span className="block text-[10px] text-neutral-500">Why won / excluded</span>
            <input name="notes" className={inputCls} />
          </label>
          <label className="mb-1.5 flex items-center gap-1.5 text-[11px] text-neutral-600">
            <input type="checkbox" name="is_winner" /> Winner
          </label>
          <div className="mb-0.5 flex gap-1.5">
            <button type="submit" className="rounded-md bg-solux px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-solux-dark">
              Add
            </button>
            <button type="button" onClick={() => setAdding(false)} className="rounded border border-neutral-200 px-2 py-1 text-[11px] text-neutral-600 hover:bg-white">
              Cancel
            </button>
          </div>
        </form>
      )}

      {tender.participants.length === 0 && !adding && (
        <p className="mt-1.5 text-[12px] text-neutral-400">
          Who won? Who bid? Each company here is a hot lead — promote it to a prospect.
        </p>
      )}

      <ul className="mt-1.5 space-y-1">
        {tender.participants.map((pp) => (
          <li key={pp.id} className="group flex flex-wrap items-center justify-between gap-2 text-[12px]">
            <span className="min-w-0">
              <span className="font-medium text-neutral-800">{pp.company_name}</span>
              {pp.is_winner && (
                <span className="ml-1.5 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
                  Winner
                </span>
              )}
              <span className="text-neutral-400">
                {pp.country ? ` · ${pp.country}` : ""}
                {pp.bid_value != null ? ` · ${money(pp.bid_value)}` : ""}
                {pp.notes ? ` · ${pp.notes}` : ""}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              {pp.promoted_prospect_id ? (
                <span className="text-[11px] text-neutral-400">→ prospect created</span>
              ) : (
                <form
                  action={async (fd) => {
                    try {
                      await promoteParticipantToProspect(fd);
                      toast.success(`"${pp.company_name}" promoted to prospect`);
                    } catch (e: any) {
                      toast.error(e?.message ?? "Could not promote.");
                    }
                  }}
                >
                  <input type="hidden" name="id" value={pp.id} />
                  <button className="rounded border border-neutral-300 px-2 py-0.5 text-[11px] font-semibold text-neutral-800 hover:bg-white">
                    Promote to prospect
                  </button>
                </form>
              )}
              <form
                action={async (fd) => {
                  try {
                    await deleteTenderParticipant(fd);
                  } catch (e: any) {
                    toast.error(e?.message ?? "Could not delete.");
                  }
                }}
              >
                <input type="hidden" name="id" value={pp.id} />
                <button className="rounded px-1 text-[11px] text-neutral-400 opacity-0 transition-opacity hover:bg-rose-50 hover:text-rose-600 group-hover:opacity-100">
                  ×
                </button>
              </form>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TendersPanel({
  tenders,
  clients,
  prospects,
}: {
  tenders: TenderRow[];
  clients: CompanyOption[];
  prospects: CompanyOption[];
}) {
  const [adding, setAdding] = useState(false);

  return (
    <section className="panel p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="eyebrow">Tenders — raw</div>
          <p className="mt-0.5 text-[12px] text-neutral-500">
            Open = attach to a partner and defend (→ affair). Result = competitor intel that
            generates prospects.
          </p>
        </div>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded-md bg-solux px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-solux-dark"
          >
            + Add tender
          </button>
        )}
      </div>

      {adding && <AddTenderForm onClose={() => setAdding(false)} />}

      {tenders.length === 0 && !adding && (
        <p className="text-[12px] text-neutral-400">No tenders in the sandbox.</p>
      )}

      <div className="space-y-3">
        {tenders.map((t) => (
          <div key={t.id} className="rounded-lg border border-neutral-200 p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${
                      t.type === "open"
                        ? "bg-sky-50 text-sky-700 ring-sky-200"
                        : "bg-violet-50 text-violet-700 ring-violet-200"
                    }`}
                  >
                    {t.type === "open" ? "Open — to defend" : "Result — intel"}
                  </span>
                  <span className="text-sm font-semibold text-neutral-900">{t.title}</span>
                  {t.status !== "new" && (
                    <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-500 ring-1 ring-neutral-200">
                      {t.status}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-[12px] text-neutral-500">
                  {[t.reference, t.country, money(t.value), t.deadline ? `deadline ${t.deadline}` : null, t.notes]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {t.status !== "closed" && t.status !== "converted" && (
                  <form
                    action={async (fd) => {
                      try {
                        await closeTender(fd);
                      } catch (e: any) {
                        toast.error(e?.message ?? "Could not close.");
                      }
                    }}
                  >
                    <input type="hidden" name="id" value={t.id} />
                    <button className="rounded border border-neutral-200 px-2 py-0.5 text-[11px] text-neutral-600 hover:bg-neutral-50">
                      Close
                    </button>
                  </form>
                )}
                <form
                  action={async (fd) => {
                    try {
                      await deleteTender(fd);
                    } catch (e: any) {
                      toast.error(e?.message ?? "Could not delete.");
                    }
                  }}
                >
                  <input type="hidden" name="id" value={t.id} />
                  <button className="rounded px-1.5 py-0.5 text-[11px] text-neutral-400 hover:bg-rose-50 hover:text-rose-600" title="Delete tender">
                    ×
                  </button>
                </form>
              </div>
            </div>

            {/* OPEN tender — attach to the bidding partner, then convert. */}
            {t.type === "open" && t.status !== "closed" && (
              <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-neutral-100 bg-neutral-50/40 p-2.5">
                {t.converted_affair_id ? (
                  <span className="text-[12px] text-neutral-600">
                    Converted into an affair{t.attachedName ? ` under ${t.attachedName}` : ""} —{" "}
                    <Link href={`/affairs/${t.converted_affair_id}`} className="font-semibold underline decoration-dotted underline-offset-2 hover:text-neutral-900">
                      open the affair →
                    </Link>
                  </span>
                ) : (
                  <>
                    <form
                      action={async (fd) => {
                        try {
                          await attachTender(fd);
                          toast.success("Tender attached");
                        } catch (e: any) {
                          toast.error(e?.message ?? "Could not attach.");
                        }
                      }}
                      className="flex flex-wrap items-center gap-1.5"
                    >
                      <input type="hidden" name="id" value={t.id} />
                      <span className="text-[12px] text-neutral-600">
                        {t.attachedName ? (
                          <>Partner: <b>{t.attachedName}</b></>
                        ) : (
                          "Attach to the bidding partner:"
                        )}
                      </span>
                      <select
                        name="target"
                        defaultValue={
                          t.attached_client_id
                            ? `client:${t.attached_client_id}`
                            : t.attached_prospect_id
                              ? `prospect:${t.attached_prospect_id}`
                              : ""
                        }
                        className="rounded border border-neutral-200 px-1.5 py-0.5 text-[11px] text-neutral-700"
                      >
                        <option value="">— pick a company —</option>
                        <optgroup label="Clients">
                          {clients.map((c) => (
                            <option key={c.id} value={`client:${c.id}`}>{c.name}</option>
                          ))}
                        </optgroup>
                        <optgroup label="Prospects">
                          {prospects.map((p) => (
                            <option key={p.id} value={`prospect:${p.id}`}>{p.name}</option>
                          ))}
                        </optgroup>
                      </select>
                      <button className="rounded border border-neutral-300 px-2 py-0.5 text-[11px] font-semibold text-neutral-800 hover:bg-white">
                        Attach
                      </button>
                    </form>
                    {(t.attached_client_id || t.attached_prospect_id) && (
                      <form
                        action={async (fd) => {
                          try {
                            await convertTenderToAffair(fd); // redirects to the affair
                          } catch (e: any) {
                            if (isNavError(e)) throw e;
                            toast.error(e?.message ?? "Could not convert.");
                          }
                        }}
                      >
                        <input type="hidden" name="id" value={t.id} />
                        <button className="rounded-md bg-solux px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-solux-dark">
                          Convert to affair →
                        </button>
                      </form>
                    )}
                  </>
                )}
              </div>
            )}

            {/* RESULT tender — the competitor intel + prospect generator. */}
            {t.type === "result" && <ParticipantsBlock tender={t} />}
          </div>
        ))}
      </div>
    </section>
  );
}
