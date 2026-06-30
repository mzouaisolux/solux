"use client";

// =====================================================================
// Contacts card (CRM step 2, m101) — the client's address book.
// Lives in the Contacts tab of the client hub. List + add / edit /
// delete + one primary contact per client. The embedded company contact
// (clients.contact_name) is displayed separately below this card and is
// still what documents print.
// =====================================================================

import { useState } from "react";
import {
  createContactAction,
  updateContactAction,
  deleteContactAction,
} from "@/app/(app)/clients/actions";
import { toast } from "@/components/feedback/toast-store";

export type ContactRow = {
  id: string;
  client_id: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  is_primary: boolean;
  notes: string | null;
};

function ContactForm({
  clientId,
  contact,
  onClose,
}: {
  clientId: string;
  contact?: ContactRow;
  onClose: () => void;
}) {
  const inputCls =
    "mt-0.5 w-full rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-200";
  return (
    <form
      action={async (fd) => {
        try {
          if (contact) await updateContactAction(fd);
          else await createContactAction(fd);
          toast.success(contact ? "Contact updated" : "Contact added");
          onClose();
        } catch (e: any) {
          toast.error(e?.message ?? "Could not save the contact.");
        }
      }}
      className="rounded-lg border border-neutral-200 bg-neutral-50/60 p-3 space-y-2"
    >
      <input type="hidden" name="client_id" value={clientId} />
      {contact && <input type="hidden" name="id" value={contact.id} />}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <label className="block">
          <span className="text-[11px] text-neutral-500">Name *</span>
          <input name="name" required autoFocus defaultValue={contact?.name ?? ""} placeholder="e.g. Awa Diallo" className={inputCls} />
        </label>
        <label className="block">
          <span className="text-[11px] text-neutral-500">Role / title</span>
          <input name="title" defaultValue={contact?.title ?? ""} placeholder="e.g. Procurement manager" className={inputCls} />
        </label>
        <label className="block">
          <span className="text-[11px] text-neutral-500">Email</span>
          <input name="email" type="email" defaultValue={contact?.email ?? ""} placeholder="name@company.com" className={inputCls} />
        </label>
        <label className="block">
          <span className="text-[11px] text-neutral-500">Phone</span>
          <input name="phone" defaultValue={contact?.phone ?? ""} placeholder="+229 …" className={inputCls} />
        </label>
        <label className="block md:col-span-2">
          <span className="text-[11px] text-neutral-500">Notes</span>
          <input name="notes" defaultValue={contact?.notes ?? ""} placeholder="optional" className={inputCls} />
        </label>
      </div>
      <div className="flex items-center justify-between pt-1">
        <label className="flex items-center gap-2 text-[12px] text-neutral-600">
          <input type="checkbox" name="is_primary" defaultChecked={contact?.is_primary ?? false} />
          Primary contact
        </label>
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="rounded border border-neutral-200 px-2.5 py-1 text-[11px] text-neutral-600 hover:bg-neutral-50">
            Cancel
          </button>
          <button type="submit" className="rounded-md bg-solux px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-solux-dark">
            {contact ? "Save" : "Add contact"}
          </button>
        </div>
      </div>
    </form>
  );
}

export function ClientContactsCard({
  clientId,
  contacts,
}: {
  clientId: string;
  contacts: ContactRow[];
}) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <section className="panel p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="eyebrow">Contacts</div>
        {!adding && (
          <button
            type="button"
            onClick={() => {
              setAdding(true);
              setEditingId(null);
            }}
            className="rounded-md bg-solux px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-solux-dark"
          >
            + Add contact
          </button>
        )}
      </div>

      {adding && <ContactForm clientId={clientId} onClose={() => setAdding(false)} />}

      {contacts.length === 0 && !adding && (
        <p className="text-[12px] text-neutral-400">
          No contacts yet — add the people you actually talk to (buyer, technical, finance…).
        </p>
      )}

      <ul className="divide-y divide-neutral-100">
        {contacts.map((c) =>
          editingId === c.id ? (
            <li key={c.id} className="py-2">
              <ContactForm clientId={clientId} contact={c} onClose={() => setEditingId(null)} />
            </li>
          ) : (
            <li key={c.id} className="group flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-medium text-neutral-800">
                  <span className="truncate">{c.name}</span>
                  {c.is_primary && (
                    <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
                      Primary
                    </span>
                  )}
                  {c.title && <span className="truncate text-[12px] font-normal text-neutral-500">{c.title}</span>}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 text-[12px] text-neutral-500">
                  {c.email && (
                    <a href={`mailto:${c.email}`} className="hover:text-neutral-800 hover:underline">
                      {c.email}
                    </a>
                  )}
                  {c.phone && <span>{c.phone}</span>}
                  {c.notes && <span className="text-neutral-400">{c.notes}</span>}
                </div>
              </div>
              <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(c.id);
                    setAdding(false);
                  }}
                  className="rounded border border-neutral-200 px-2 py-0.5 text-[11px] text-neutral-600 hover:bg-neutral-50"
                >
                  Edit
                </button>
                <form
                  action={async (fd) => {
                    try {
                      await deleteContactAction(fd);
                      toast.success("Contact removed");
                    } catch (e: any) {
                      toast.error(e?.message ?? "Could not remove the contact.");
                    }
                  }}
                >
                  <input type="hidden" name="id" value={c.id} />
                  <input type="hidden" name="client_id" value={clientId} />
                  <button className="rounded border border-neutral-200 px-2 py-0.5 text-[11px] text-rose-600 hover:bg-rose-50">
                    Delete
                  </button>
                </form>
              </div>
            </li>
          )
        )}
      </ul>
    </section>
  );
}
