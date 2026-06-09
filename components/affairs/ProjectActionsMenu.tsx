"use client";

// =====================================================================
// Project (affair) actions — a compact "⋯" menu replacing the old bulky
// "Project settings" block. Hosts: Rename · Archive · Mark Lost · Transfer
// ownership · Delete. Inline mini-forms for the ones that need input
// (rename / archive reason / transfer owner); confirms for the destructive
// ones (mark lost / delete). Rendered via a fixed portal so it is never
// clipped by the expansion's overflow:hidden animation container.
// =====================================================================

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  renameAffair,
  archiveAffair,
  setAffairStatus,
  setAffairOwner,
  deleteAffair,
} from "@/app/(app)/affairs/actions";
import type { Option } from "@/components/affairs/NewProjectPanel";

type Mode = "menu" | "rename" | "archive" | "transfer";

export function ProjectActionsMenu({
  affairId,
  name,
  ownerId,
  owners,
  canAssignOwner,
}: {
  affairId: string;
  name: string;
  ownerId: string | null;
  owners: Option[];
  canAssignOwner: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("menu");
  const [coords, setCoords] = useState<{ top: number; right: number } | null>(
    null,
  );
  const [pending, startTransition] = useTransition();
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const reposition = () => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setCoords({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
  };

  useLayoutEffect(() => {
    if (open) reposition();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function close() {
    setOpen(false);
    setMode("menu");
  }

  /** Run a server action with a prepared FormData, surface errors, then refresh. */
  function run(action: (fd: FormData) => Promise<void>, fd: FormData) {
    if (pending) return;
    startTransition(async () => {
      try {
        await action(fd);
        close();
        router.refresh();
      } catch (err: any) {
        if (err?.digest && String(err.digest).startsWith("NEXT_REDIRECT")) throw err;
        window.alert(err?.message || "Action failed.");
      }
    });
  }

  function markLost() {
    if (!window.confirm("Mark this project as Lost?")) return;
    const fd = new FormData();
    fd.set("id", affairId);
    fd.set("status", "lost");
    run(setAffairStatus, fd);
  }

  function del() {
    if (
      !window.confirm(
        "Delete this project? Only empty projects can be deleted — if quotations are still linked it will be refused (use Archive instead).",
      )
    )
      return;
    const fd = new FormData();
    fd.set("id", affairId);
    run(deleteAffair, fd);
  }

  const itemCls =
    "block w-full text-left px-3 py-2 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-60";

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-label="Project actions"
        aria-expanded={open}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-neutral-200 bg-white text-neutral-500 shadow-sm transition-colors hover:border-neutral-300 hover:bg-neutral-50 hover:text-neutral-900"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
          <circle cx="3" cy="8" r="1.4" />
          <circle cx="8" cy="8" r="1.4" />
          <circle cx="13" cy="8" r="1.4" />
        </svg>
      </button>

      {open &&
        coords &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            style={{ position: "fixed", top: coords.top, right: coords.right }}
            className="po-premium z-[100] w-[240px] overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-xl"
          >
            {mode === "menu" && (
              <div className="py-1">
                <button type="button" className={itemCls} onClick={() => setMode("rename")}>
                  Rename project
                </button>
                <button type="button" className={itemCls} onClick={() => setMode("archive")}>
                  Archive project
                </button>
                <button
                  type="button"
                  className={itemCls}
                  disabled={pending}
                  onClick={markLost}
                >
                  Mark lost
                </button>
                {canAssignOwner && (
                  <button type="button" className={itemCls} onClick={() => setMode("transfer")}>
                    Transfer ownership
                  </button>
                )}
                <div className="my-1 border-t border-neutral-100" />
                <button
                  type="button"
                  className="block w-full px-3 py-2 text-left text-xs text-rose-600 hover:bg-rose-50 disabled:opacity-60"
                  disabled={pending}
                  onClick={del}
                >
                  Delete project
                </button>
              </div>
            )}

            {mode === "rename" && (
              <form
                className="space-y-2 p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  fd.set("id", affairId);
                  run(renameAffair, fd);
                }}
              >
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                  Rename project
                </label>
                <input
                  name="name"
                  defaultValue={name}
                  autoFocus
                  required
                  className="w-full rounded border border-neutral-200 px-2 py-1 text-xs focus:border-solux focus:outline-none"
                />
                <FormButtons pending={pending} confirmLabel="Save" onCancel={() => setMode("menu")} />
              </form>
            )}

            {mode === "archive" && (
              <form
                className="space-y-2 p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  fd.set("id", affairId);
                  run(archiveAffair, fd);
                }}
              >
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                  Archive reason (required)
                </label>
                <textarea
                  name="reason"
                  required
                  rows={2}
                  autoFocus
                  placeholder="e.g. client chose another supplier"
                  className="w-full rounded border border-neutral-200 px-2 py-1 text-xs focus:border-solux focus:outline-none"
                />
                <FormButtons pending={pending} confirmLabel="Archive" onCancel={() => setMode("menu")} />
              </form>
            )}

            {mode === "transfer" && (
              <form
                className="space-y-2 p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  fd.set("id", affairId);
                  run(setAffairOwner, fd);
                }}
              >
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                  Transfer to owner
                </label>
                <select
                  name="owner_id"
                  defaultValue={ownerId ?? "__unassign__"}
                  className="w-full rounded border border-neutral-200 px-2 py-1 text-xs focus:border-solux focus:outline-none"
                >
                  <option value="__unassign__">— unassigned —</option>
                  {owners.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
                <FormButtons pending={pending} confirmLabel="Transfer" onCancel={() => setMode("menu")} />
              </form>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

function FormButtons({
  pending,
  confirmLabel,
  onCancel,
}: {
  pending: boolean;
  confirmLabel: string;
  onCancel: () => void;
}) {
  return (
    <div className="flex items-center justify-end gap-2 pt-0.5">
      <button
        type="button"
        onClick={onCancel}
        className="rounded px-2 py-1 text-[11px] text-neutral-500 hover:text-neutral-700"
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-solux px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-solux-dark disabled:opacity-60"
      >
        {pending ? "Working…" : confirmLabel}
      </button>
    </div>
  );
}
