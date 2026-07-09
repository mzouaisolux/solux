"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  subscribeTray,
  removeFromTray,
  clearTray,
  type TrayItem,
} from "./document-tray-store";

/**
 * DocumentTray — the floating panel (bottom-left) listing documents PREPARED
 * for email: already downloaded, waiting to be attached. Mirrors
 * components/feedback/Toaster.tsx (module-store subscription + portal to
 * <body>). Persists across navigation so the files stay available while the
 * user switches to their mail client. Mounted once in the (app) layout.
 *
 * Phase 2 (server send) removes the "attach manually" framing but keeps this
 * component — it becomes "sent" confirmation. Nothing about the mount changes.
 */
export function DocumentTray() {
  const [items, setItems] = useState<TrayItem[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    return subscribeTray(setItems);
  }, []);

  if (!mounted || items.length === 0) return null;

  const many = items.length > 1;

  return createPortal(
    <div className="fixed bottom-4 left-4 z-[55] w-[300px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xl">
      <div className="flex items-center justify-between gap-2 border-b border-neutral-100 px-3.5 py-2.5">
        <div className="text-[12px] font-semibold text-neutral-800">
          📧 Email préparé
        </div>
        <button
          type="button"
          onClick={() => clearTray()}
          className="text-[11px] font-medium text-neutral-400 hover:text-neutral-700"
        >
          Terminé
        </button>
      </div>
      <p className="px-3.5 pt-2 text-[11px] leading-relaxed text-neutral-500">
        Déjà téléchargé{many ? "s" : ""} — glissez le{many ? "s" : ""} document
        {many ? "s" : ""} dans votre email (ou attachez depuis vos Téléchargements).
      </p>
      <ul className="max-h-64 space-y-0.5 overflow-y-auto p-2">
        {items.map((it) => (
          <li
            key={it.id}
            draggable
            onDragStart={(e) => {
              // Progressive enhancement — lets the file drag out to the OS / a
              // compatible mail client where supported (Chromium). Effectively
              // a no-op for blob: URLs in most browsers; harmless because the
              // file is already on disk. We never build the UX around it.
              try {
                e.dataTransfer.setData(
                  "DownloadURL",
                  `application/octet-stream:${it.name}:${it.blobUrl}`
                );
                e.dataTransfer.effectAllowed = "copy";
              } catch {
                /* ignore */
              }
            }}
            className="group flex cursor-grab items-center gap-2 rounded-md px-2 py-1.5 hover:bg-neutral-50 active:cursor-grabbing"
            title="Glissez ce document dans votre email"
          >
            <span aria-hidden>📄</span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12px] font-medium text-neutral-800">
                {it.name}
              </div>
              <div className="text-[10px] text-neutral-400">{it.kindLabel}</div>
            </div>
            <a
              href={it.blobUrl}
              download={it.name}
              className="rounded px-1 text-[12px] font-medium text-neutral-400 hover:text-neutral-900"
              title="Re-télécharger"
            >
              ↓
            </a>
            <button
              type="button"
              onClick={() => removeFromTray(it.id)}
              className="rounded px-1 text-[12px] text-neutral-300 hover:text-rose-600"
              aria-label="Retirer"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </div>,
    document.body
  );
}
