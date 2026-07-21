"use client";

import { useEffect, useRef, useState } from "react";
import type { ProjectDocument } from "@/lib/project-documents";

/**
 * Inline document previews for the affair file list.
 *
 * Goal (owner, 2026-07-16): recognise a document — and tell versions apart —
 * WITHOUT opening it.
 *
 *   • summary — commercial docs (quotation / proforma / order confirmation).
 *     We already hold amount, product count and date, so this costs nothing:
 *     the amount alone usually tells V1 from V2 instantly.
 *   • thumb   — real files behind a signed URL:
 *       – images: <img>, lazy.
 *       – PDFs: FIRST PAGE rasterised to a small JPEG via pdf.js (canvas).
 *
 * Performance rules learned the hard way (2026-07-16): a native PDF <iframe>
 * per row FREEZES the renderer — never do that. Instead we
 *   – render only when the row scrolls into view (IntersectionObserver),
 *   – cap concurrent rasterisations (MAX_PARALLEL),
 *   – cache each rendered thumbnail per URL for the session.
 * Any failure (CORS, corrupt file, unsupported type) falls back to a typed
 * placeholder / the existing icon — previews are strictly additive.
 */

/* ----------------------------- pdf.js plumbing ---------------------------- */

/** url → dataURL. Survives re-renders and tab switches within the session. */
const thumbCache = new Map<string, string>();
const MAX_PARALLEL = 2;
let inFlight = 0;
const waiting: Array<() => void> = [];

function runThrottled(task: () => Promise<void>) {
  const start = () => {
    inFlight++;
    void task().finally(() => {
      inFlight--;
      waiting.shift()?.();
    });
  };
  if (inFlight < MAX_PARALLEL) start();
  else waiting.push(start);
}

async function renderPdfThumb(url: string): Promise<string> {
  const cached = thumbCache.get(url);
  if (cached) return cached;

  // Dynamic import: keeps pdf.js out of the initial bundle entirely.
  const pdfjs: any = await import("pdfjs-dist");
  // Static asset, NOT the `new URL(..., import.meta.url)` bundler form: that
  // makes webpack pull the worker into the bundle, and pdfjs-dist v6's worker
  // uses syntax the Next 14 build cannot parse — it broke `next build` while
  // `next dev` kept working. public/pdf.worker.min.mjs is refreshed on every
  // install and build by scripts/copy-pdf-worker.mjs, so it always matches the
  // installed pdfjs-dist version.
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

  const doc = await pdfjs.getDocument({
    url,
    disableAutoFetch: true, // first page only — don't pull the whole file
    disableStream: true,
  }).promise;
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const targetWidth = 144; // ~4x the 36px box → crisp on retina
    const viewport = page.getViewport({ scale: targetWidth / base.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const canvasContext = canvas.getContext("2d");
    if (!canvasContext) throw new Error("no 2d context");
    await page.render({ canvasContext, viewport, canvas }).promise;
    const data = canvas.toDataURL("image/jpeg", 0.72);
    thumbCache.set(url, data);
    return data;
  } finally {
    doc.destroy?.();
  }
}

/* ------------------------------- components ------------------------------- */

export function DocSummaryPreview({ d }: { d: ProjectDocument }) {
  const p = d.preview;
  if (!p || p.kind !== "summary") return null;
  if (!p.headline && p.facts.length === 0) return null;
  return (
    <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
      {p.headline && (
        <span className="text-[12px] font-semibold tabular-nums text-neutral-800">
          {p.headline}
        </span>
      )}
      {p.facts.map((f, i) => (
        <span key={i} className="text-[11px] text-neutral-500">
          <b className="font-medium tabular-nums text-neutral-600">{f.value}</b>{" "}
          {f.label.toLowerCase()}
        </span>
      ))}
    </div>
  );
}

/** Small lazy thumbnail (images + PDF first page). Null when not previewable. */
export function DocThumb({ d }: { d: ProjectDocument }) {
  const p = d.preview;
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pdfSrc, setPdfSrc] = useState<string | null>(
    p && p.kind === "pdf" ? thumbCache.get(p.url) ?? null : null
  );

  // Lazy: only once the row is (nearly) on screen.
  useEffect(() => {
    const el = boxRef.current;
    if (!el || visible) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  // Rasterise the PDF first page once visible (throttled + cached).
  useEffect(() => {
    if (!visible || !p || p.kind !== "pdf" || pdfSrc || failed) return;
    let alive = true;
    runThrottled(async () => {
      try {
        const data = await renderPdfThumb(p.url);
        if (alive) setPdfSrc(data);
      } catch (e) {
        // Keep the row usable, but surface WHY in dev so a systematic
        // failure (worker path, CORS…) isn't silently hidden.
        if (process.env.NODE_ENV !== "production")
          console.warn("[DocThumb] pdf thumbnail failed:", p.url, e);
        if (alive) setFailed(true); // CORS / corrupt / unsupported → placeholder
      }
    });
    return () => {
      alive = false;
    };
  }, [visible, p, pdfSrc, failed]);

  if (!p || p.kind === "summary") return null;
  if (p.kind === "sheet") return null; // spreadsheet preview: next iteration

  return (
    <div
      ref={boxRef}
      className="relative h-[46px] w-[36px] flex-none overflow-hidden rounded border border-neutral-200 bg-neutral-50"
      aria-hidden
    >
      {p.kind === "image" && visible && !failed && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={p.url}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      )}
      {p.kind === "pdf" && pdfSrc && !failed && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={pdfSrc} alt="" className="h-full w-full object-cover object-top" />
      )}
      {/* Placeholder while loading, and permanent fallback on failure. */}
      {((p.kind === "pdf" && !pdfSrc) || failed) && (
        <span className="flex h-full w-full items-center justify-center bg-neutral-100 text-[8px] font-bold uppercase tracking-wide text-neutral-500">
          {failed ? (p.kind === "pdf" ? "PDF" : "FILE") : "PDF"}
        </span>
      )}
    </div>
  );
}
