"use client";

import { useEffect, useState } from "react";
import {
  subscribeSendModal,
  closeSendModal,
  type SendModalProps,
} from "./send-modal-store";
import { SendDocumentsModal } from "./SendDocumentsModal";

/**
 * The single mount point for the generic SendDocumentsModal. Any surface opens
 * it via `openSendModal(...)`; because the modal lives here (not under the
 * trigger), it survives triggers that unmount themselves — e.g. a "…" menu.
 * Mounted once in the (app) layout, beside <DocumentTray/>.
 */
export function SendModalHost() {
  const [props, setProps] = useState<SendModalProps | null>(null);
  useEffect(() => subscribeSendModal(setProps), []);
  if (!props) return null;
  // Remount per open (key on the docs) so internal state resets each time.
  return (
    <SendDocumentsModal
      key={props.documents.map((d) => d.id).join("|")}
      {...props}
      onClose={closeSendModal}
    />
  );
}
