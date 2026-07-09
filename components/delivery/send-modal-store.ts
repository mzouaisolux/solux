// =====================================================================
// Send-modal store — lets ANY surface (a button, a "…" menu item, a future
// keyboard shortcut) open the ONE generic SendDocumentsModal, which lives in a
// single global host. This is what makes the modal survive being triggered
// from inside <ContextMenu>, whose panel unmounts its children on click.
// Module-level pub/sub, same shape as document-tray-store / toast-store.
// =====================================================================

import type { DeliverableDocument } from "@/lib/document-delivery";

export type SendModalProps = {
  documents: DeliverableDocument[];
  preselectedIds?: string[];
  affairId?: string | null;
  clientId?: string | null;
  clientEmail?: string | null;
  affairName?: string | null;
  onAfterSend?: () => void;
};

let current: SendModalProps | null = null;
let listeners: Array<(p: SendModalProps | null) => void> = [];

function emit() {
  for (const l of listeners) l(current);
}

export function subscribeSendModal(
  listener: (p: SendModalProps | null) => void
): () => void {
  listeners.push(listener);
  listener(current);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

/** Open the global send modal with the given documents + context. */
export function openSendModal(props: SendModalProps): void {
  current = props;
  emit();
}

export function closeSendModal(): void {
  current = null;
  emit();
}
