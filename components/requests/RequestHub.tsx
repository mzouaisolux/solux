"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  REQUEST_TYPES,
  requestHref,
  type RequestTypeDef,
} from "@/lib/request-types";
import { quickCreateAffair } from "@/app/(app)/affairs/actions";
import { createClient } from "@/lib/supabase/client";
import { pushToast } from "@/components/feedback/toast-store";

/**
 * REQUEST HUB — the workflow-first entry point (owner 2026-07-08): the user
 * doesn't hunt for a screen, they create a Request. One registry
 * (lib/request-types.ts) drives every surface; this component is the shared
 * "➕ New Request ▼" trigger used on the client page and the affair page.
 *
 * Context rules:
 *  - `affairId` known (affair page)  → every request links to THAT affair
 *    directly. No extra selection.
 *  - only `clientId` (client page)   → after picking a type: exactly one live
 *    affair → use it; several → "Which affair should this request be attached
 *    to?"; none → "Create New Affair & Continue" (inline, via
 *    quickCreateAffair). The user never leaves their workflow.
 *
 * Coming-soon types render greyed with a badge — training users to the
 * architecture before the module ships. ADDITIVE: replaces nothing.
 */
export function RequestHub({
  clientId = null,
  affairId = null,
  canCreate,
  variant = "light",
  label = "➕ New Request",
}: {
  clientId?: string | null;
  affairId?: string | null;
  /** hasUiCapability("project.create") resolved server-side by the caller. */
  canCreate: boolean;
  variant?: "primary" | "light";
  label?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Second step (client context only): pick / create the affair for `picking`.
  const [picking, setPicking] = useState<RequestTypeDef | null>(null);

  if (!canCreate) return null;

  const triggerCls =
    variant === "primary"
      ? "inline-flex items-center gap-1.5 rounded-md bg-solux px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-solux-dark"
      : "inline-flex items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-neutral-800 hover:bg-neutral-50";

  function pick(def: RequestTypeDef) {
    setOpen(false);
    if (affairId) {
      // Affair context — attach automatically, zero extra questions.
      router.push(requestHref(def, { affairId }));
      return;
    }
    // Client context — resolve the affair first (picker modal).
    setPicking(def);
  }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={triggerCls}
        title="Create a request — what do you need to move this forward?"
      >
        {label} <span className="text-[10px] opacity-70">▼</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-1 w-80 rounded-lg border border-neutral-200 bg-white p-1.5 shadow-xl">
            {REQUEST_TYPES.map((r) => {
              const soon = r.status === "coming_soon";
              return (
                <button
                  key={r.key}
                  type="button"
                  disabled={soon}
                  onClick={() => pick(r)}
                  className={`flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left ${
                    soon ? "cursor-default opacity-50" : "hover:bg-neutral-50"
                  }`}
                >
                  <span className="text-[14px] leading-5" aria-hidden>
                    {r.emoji ?? "•"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-neutral-800">
                      <span className="truncate">New {r.label}</span>
                      {soon && (
                        <span className="shrink-0 rounded-full border border-neutral-200 bg-neutral-100 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-neutral-500">
                          Coming Soon
                        </span>
                      )}
                    </span>
                    {r.description && (
                      <span className="block truncate text-[10.5px] text-neutral-400">
                        {r.description}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {picking && clientId && (
        <AffairPickerModal
          clientId={clientId}
          request={picking}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  );
}

/* =========================================================================
   Affair picker — "Which affair should this request be attached to?"
   1 live affair → auto-continue; several → radio list; none → create inline.
   ========================================================================= */
function AffairPickerModal({
  clientId,
  request,
  onClose,
}: {
  clientId: string;
  request: RequestTypeDef;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [affairs, setAffairs] = useState<{ id: string; name: string }[] | null>(
    null
  );
  const [selected, setSelected] = useState<string>("");
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Load the client's live affairs once (same filter as the quotation builder).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await createClient()
          .from("affairs")
          .select("id, name")
          .eq("client_id", clientId)
          .is("archived_at", null)
          .not("status", "in", "(lost,abandoned)")
          .order("created_at", { ascending: false });
        if (cancelled) return;
        const list = (data ?? []) as { id: string; name: string }[];
        // Exactly ONE live affair → no question to ask, continue directly.
        if (list.length === 1) {
          router.push(requestHref(request, { affairId: list[0].id }));
          onClose();
          return;
        }
        setAffairs(list);
        if (list.length > 0) setSelected(list[0].id);
      } catch {
        if (!cancelled) setAffairs([]);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  function go(affairId: string) {
    router.push(requestHref(request, { affairId }));
    onClose();
  }

  function createAndContinue() {
    const name = newName.trim();
    if (!name) return;
    startTransition(async () => {
      try {
        const { id } = await quickCreateAffair({ clientId, name });
        pushToast(`Project “${name}” created`);
        // Hard navigation on purpose: quickCreateAffair revalidates paths,
        // and the client-side refresh that triggers can swallow a
        // router.push issued in the same window (Next 14 race). A full
        // load is fine — we're leaving the page anyway.
        window.location.assign(requestHref(request, { affairId: id }));
      } catch (e: any) {
        setError(e?.message ?? "Could not create the affair");
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/50 p-4"
      onClick={() => !pending && onClose()}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-neutral-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-neutral-100 px-5 py-4">
          <div className="eyebrow mb-1">New {request.label}</div>
          <div className="text-sm font-semibold text-neutral-900">
            Which affair should this request be attached to?
          </div>
        </div>

        <div className="space-y-3 px-5 py-4">
          {affairs === null ? (
            <p className="text-sm text-neutral-400">Loading affairs…</p>
          ) : affairs.length > 0 ? (
            <div className="max-h-52 space-y-0.5 overflow-y-auto">
              {affairs.map((a) => (
                <label
                  key={a.id}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-neutral-50"
                >
                  <input
                    type="radio"
                    name="affair"
                    checked={selected === a.id}
                    onChange={() => setSelected(a.id)}
                    className="h-3.5 w-3.5"
                  />
                  <span className="truncate text-[13px] text-neutral-800">
                    {a.name}
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <p className="text-[12px] leading-relaxed text-neutral-500">
              This client has no live project yet — create one and continue,
              without leaving your workflow.
            </p>
          )}

          {/* Create New Affair & Continue — always available. */}
          <div className="rounded-md border border-dashed border-neutral-300 p-2.5">
            <label className="block text-[11px] font-medium text-neutral-600">
              {affairs && affairs.length > 0 ? "Or create a new project" : "New project name"}
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. SONABEL — highway lighting 2027"
                className="mt-1 w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm"
              />
            </label>
            <button
              type="button"
              onClick={createAndContinue}
              disabled={pending || !newName.trim()}
              className="mt-2 w-full rounded-md bg-neutral-900 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-black disabled:opacity-50"
            >
              {pending ? "Creating…" : "Create New Affair & Continue →"}
            </button>
          </div>
          {error && <p className="text-xs text-rose-600">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-neutral-100 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded-md border border-neutral-300 bg-white px-3.5 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
          >
            Cancel
          </button>
          {affairs && affairs.length > 0 && (
            <button
              type="button"
              onClick={() => selected && go(selected)}
              disabled={pending || !selected}
              className="rounded-md bg-solux px-3.5 py-2 text-sm font-semibold text-white hover:bg-solux-dark disabled:opacity-50"
            >
              Continue →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
