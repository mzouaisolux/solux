// =====================================================================
// Document Tray store — the floating panel that holds documents PREPARED
// for email (already downloaded, ready to attach). Part of the Document
// Delivery System (owner 2026-07-08). Module-level pub/sub, mirroring
// components/feedback/toast-store.ts.
//
// Unlike toasts there is NO auto-expiry: a prepared document stays in the
// tray until the user clears it, because they need it available while they
// switch to their mail client to attach it. removeFromTray / clearTray
// revoke the object URLs so blobs don't leak.
// =====================================================================

export type TrayItem = {
  id: number;
  /** Filename shown + used when re-downloading. */
  name: string;
  /** "Quotation" | "Energy Study" | "Invoice" | … */
  kindLabel: string;
  /** Object URL of the prepared blob (owned by the tray; revoked on removal). */
  blobUrl: string;
};

let items: TrayItem[] = [];
let listeners: Array<(t: TrayItem[]) => void> = [];
let nextId = 1;

function emit() {
  for (const l of listeners) l(items);
}

/** Subscribe to tray changes. Fires immediately with the current items. */
export function subscribeTray(listener: (t: TrayItem[]) => void): () => void {
  listeners.push(listener);
  listener(items);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

/** Add a prepared document to the tray. Returns its tray id. */
export function pushToTray(item: Omit<TrayItem, "id">): number {
  const id = nextId++;
  items = [...items, { ...item, id }];
  emit();
  return id;
}

export function removeFromTray(id: number): void {
  const found = items.find((t) => t.id === id);
  if (found && typeof URL !== "undefined") URL.revokeObjectURL(found.blobUrl);
  items = items.filter((t) => t.id !== id);
  emit();
}

export function clearTray(): void {
  if (typeof URL !== "undefined") {
    for (const t of items) URL.revokeObjectURL(t.blobUrl);
  }
  items = [];
  emit();
}
