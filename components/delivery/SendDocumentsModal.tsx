"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { deliver, type DeliverableDocument } from "@/lib/document-delivery";
import { useAffairRecipients } from "./useAffairRecipients";

/**
 * THE generic send modal for the Document Delivery System. Works for ONE
 * document (from the quotation page or a document row) or MANY (the affair
 * "Send Documents" assistant) — never per-type. Recipient comes from the
 * affair's CRM contacts (+ a custom address); the subject/body are templated
 * and editable; "Send" calls the single `deliver()` engine.
 */
export function SendDocumentsModal({
  documents,
  preselectedIds,
  affairId = null,
  clientId = null,
  clientEmail = null,
  affairName: affairNameProp = null,
  onClose,
  onAfterSend,
}: {
  documents: DeliverableDocument[];
  preselectedIds?: string[];
  affairId?: string | null;
  clientId?: string | null;
  clientEmail?: string | null;
  affairName?: string | null;
  onClose: () => void;
  onAfterSend?: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const {
    affairName: affairNameHook,
    contacts,
    primaryEmail,
  } = useAffairRecipients({ affairId, clientId });
  const affairName = affairNameProp ?? affairNameHook;

  // Preview mode (one auto-selected doc) vs the assistant checklist. A document
  // row / the quotation page pass NO preselection → single-doc preview. The
  // affair-level "Send documents" passes `preselectedIds` (even []) → always
  // the checklist, so the user can pick even when only one file is attachable.
  const showChecklist = documents.length > 1 || preselectedIds !== undefined;
  const single = !showChecklist;
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(preselectedIds ?? documents.map((d) => d.id))
  );
  const selectedDocs = useMemo(
    () => documents.filter((d) => selected.has(d.id)),
    [documents, selected]
  );

  // ---- Recipient ----
  const [selectedContactId, setSelectedContactId] = useState<string>("");
  const [to, setTo] = useState(clientEmail ?? "");
  const toSeeded = useRef(false);
  useEffect(() => {
    if (toSeeded.current || !primaryEmail) return;
    toSeeded.current = true;
    setTo((cur) => cur || primaryEmail);
    setSelectedContactId(contacts[0]?.id ?? "");
  }, [primaryEmail, contacts]);
  const greetingName =
    contacts.find((c) => c.id === selectedContactId)?.name ?? "customer";

  // ---- Subject / body (templated until the user edits) ----
  const subjDirty = useRef(false);
  const bodyDirty = useRef(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  useEffect(() => {
    if (!subjDirty.current) setSubject(defaultSubject(selectedDocs, affairName));
    if (!bodyDirty.current)
      setBody(defaultBody(greetingName, selectedDocs, affairName));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDocs, affairName, greetingName]);

  // ---- Single-doc inline preview (memoized resolve shared with send) ----
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!single || documents.length === 0) return;
    let active = true;
    let url: string | null = null;
    documents[0]
      .resolve()
      .then((blob) => {
        if (!active) return;
        url = URL.createObjectURL(blob);
        setPreviewUrl(url);
      })
      .catch(() => {
        /* preview is best-effort; send still works */
      });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pickContact(id: string) {
    setSelectedContactId(id);
    const c = contacts.find((x) => x.id === id);
    if (c?.email) setTo(c.email);
  }
  function toggleDoc(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function send() {
    if (selectedDocs.length === 0 || !to) return;
    startTransition(async () => {
      try {
        await deliver({ documents: selectedDocs, to, subject, body, onAfterSend });
        setDone(
          `✅ ${selectedDocs.length > 1 ? "Documents" : "Document"} prepared — attach ${
            selectedDocs.length > 1 ? "them" : "it"
          } from the tray (bottom-left) and send.`
        );
      } catch (e: any) {
        setError(e?.message ?? "Could not prepare the email");
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/50 p-4"
      onClick={() => !pending && onClose()}
    >
      <div
        className={`flex w-full ${single ? "max-w-4xl" : "max-w-lg"} max-h-[90vh] overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xl`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left — single-doc preview */}
        {single && (
          <div className="hidden w-1/2 border-r border-neutral-200 bg-neutral-100 md:block">
            {previewUrl ? (
              <iframe
                title="Document preview"
                src={`${previewUrl}#toolbar=0&navpanes=0`}
                className="h-full w-full"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-neutral-400">
                Rendering preview…
              </div>
            )}
          </div>
        )}

        {/* Right — recipient + documents + message */}
        <div className={`flex w-full flex-col ${single ? "md:w-1/2" : ""}`}>
          <div className="border-b border-neutral-100 px-5 py-4">
            <div className="eyebrow mb-1">Send documents</div>
            <div className="text-sm font-semibold text-neutral-900">
              {single ? (
                documents[0].name
              ) : (
                <>
                  {selectedDocs.length} of {documents.length} documents
                </>
              )}
            </div>
            {affairName && (
              <div className="text-xs text-neutral-500">{affairName}</div>
            )}
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
            {/* Recipient */}
            {contacts.length > 1 && (
              <label className="block text-xs font-medium text-neutral-600">
                Contact
                <select
                  value={selectedContactId}
                  onChange={(e) => pickContact(e.target.value)}
                  className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm"
                >
                  {contacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name ?? c.email}
                      {c.is_primary ? " (primary)" : ""} — {c.email}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="block text-xs font-medium text-neutral-600">
              To
              <input
                type="email"
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  setSelectedContactId("");
                }}
                placeholder="customer@company.com"
                className="mt-1 w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm"
              />
            </label>

            {/* Document checklist (only when there's more than one) */}
            {!single && (
              <div className="text-xs font-medium text-neutral-600">
                Documents
                <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto rounded-md border border-neutral-200 p-1.5">
                  {documents.map((d) => (
                    <li key={d.id}>
                      <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-neutral-50">
                        <input
                          type="checkbox"
                          checked={selected.has(d.id)}
                          onChange={() => toggleDoc(d.id)}
                          className="h-3.5 w-3.5"
                        />
                        <span className="truncate text-[12px] font-normal text-neutral-800">
                          {d.name}
                        </span>
                        <span className="ml-auto shrink-0 text-[10px] text-neutral-400">
                          {d.kindLabel}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <label className="block text-xs font-medium text-neutral-600">
              Subject
              <input
                type="text"
                value={subject}
                onChange={(e) => {
                  subjDirty.current = true;
                  setSubject(e.target.value);
                }}
                className="mt-1 w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm"
              />
            </label>
            <label className="block text-xs font-medium text-neutral-600">
              Message
              <textarea
                value={body}
                onChange={(e) => {
                  bodyDirty.current = true;
                  setBody(e.target.value);
                }}
                rows={single ? 8 : 6}
                className="mt-1 w-full resize-none rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm"
              />
            </label>
            <p className="rounded-md bg-neutral-50 px-3 py-2 text-[11px] text-neutral-500">
              On send, the selected file{selectedDocs.length > 1 ? "s are" : " is"}{" "}
              downloaded and appear in the tray (bottom-left) ready to attach,
              and your email client opens pre-addressed. (Browser email can&apos;t
              attach automatically — drag the file{selectedDocs.length > 1 ? "s" : ""} in.)
            </p>
            {done && <p className="text-xs text-emerald-700">{done}</p>}
            {error && <p className="text-xs text-rose-600">{error}</p>}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-neutral-100 px-5 py-3">
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="rounded-md border border-neutral-300 bg-white px-3.5 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
            >
              {done ? "Close" : "Cancel"}
            </button>
            <button
              type="button"
              onClick={send}
              disabled={pending || !to || selectedDocs.length === 0 || !!done}
              className="rounded-md bg-solux px-3.5 py-2 text-sm font-semibold text-white hover:bg-solux-dark disabled:opacity-50"
            >
              {pending ? "Preparing…" : "📧 Send"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function defaultSubject(
  docs: DeliverableDocument[],
  affair: string | null
): string {
  if (docs.length === 1)
    return affair ? `${docs[0].kindLabel} — ${affair}` : docs[0].name;
  return affair ? `Documents — ${affair}` : "Documents";
}

function defaultBody(
  customerName: string,
  docs: DeliverableDocument[],
  affair: string | null
): string {
  const intro =
    docs.length === 1
      ? `Please find attached ${docs[0].name}`
      : `Please find attached the following documents:\n${docs
          .map((d) => `• ${d.name}`)
          .join("\n")}`;
  return (
    `Dear ${customerName},\n\n` +
    `${intro}${affair ? ` regarding ${affair}` : ""}.\n\n` +
    `Should you have any questions or require any modifications, please feel free to contact us.\n\n` +
    `Best regards,\n\nSOLUX Technology`
  );
}
