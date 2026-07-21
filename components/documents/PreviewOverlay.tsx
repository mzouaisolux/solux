"use client";

import { useEffect, useState } from "react";

/**
 * Full-screen document preview — read a PDF (or an image) without leaving the
 * workspace. Used by the affair Quotations list and the affair Documents card.
 *
 * Why it fetches the file instead of pointing the iframe straight at the URL
 * (measured 2026-07-21, owner's Chrome): `<iframe src="/api/documents/…/pdf">`
 * never navigates — no load event, no network request at all — so the overlay
 * stayed blank. The very same PDF handed to the iframe as a `blob:` URL renders
 * fine. Subframe navigations to a PDF endpoint are blocked before the request
 * leaves the browser (extension-level filtering); a same-page `fetch` is not.
 *
 * So: fetch once, hand the iframe a blob. If the fetch itself fails (a
 * cross-origin signed URL without CORS, an expired link…), fall back to the
 * plain `src` iframe — never worse than before.
 *
 * NOTE: one overlay is mounted ON DEMAND, never one per row — an iframe per
 * list row freezes the renderer (measured 2026-07-16).
 */
export function PreviewOverlay({
  src,
  title,
  onClose,
}: {
  src: string;
  title: string;
  onClose: () => void;
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    let created: string | null = null;
    (async () => {
      try {
        const res = await fetch(src, { credentials: "same-origin" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        if (!alive) return;
        created = URL.createObjectURL(blob);
        setBlobUrl(created);
      } catch (e) {
        if (process.env.NODE_ENV !== "production")
          console.warn("[PreviewOverlay] fetch failed, using direct src:", src, e);
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [src]);

  // Escape closes — expected of anything full-screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/70 p-4 md:p-8"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="truncate text-sm font-medium text-white">{title}</span>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md bg-white/10 px-2.5 py-1 text-xs font-semibold text-white hover:bg-white/20"
        >
          ✕ Close
        </button>
      </div>
      {blobUrl || failed ? (
        <iframe
          src={blobUrl ?? src}
          title={title}
          className="min-h-0 flex-1 rounded-lg border border-white/20 bg-white"
        />
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-white/20 bg-white text-sm text-neutral-400">
          Loading preview…
        </div>
      )}
    </div>
  );
}
