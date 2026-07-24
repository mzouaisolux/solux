"use client";

/**
 * Baseline import (spec.import — admin only). A 3-step wizard:
 *   1. Choose source — Extract from PDF (beta) · Import a CSV · Enter manually
 *   2. Preview (dry run) — non-writing match check
 *   3. Import — commit, then optionally attach the designed PDF
 *
 * Same server actions as before (dryRunImport / importBaseline /
 * extractSpecSheet / recordUploadedSpecSheet); only the layout is stepped.
 * The CSV is parsed with a small inline parser (quoted fields + embedded
 * commas). Only .csv is parsed; PDFs are text-extracted server-side.
 */

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { dryRunImport, importBaseline, recordUploadedSpecSheet, extractSpecSheet } from "../actions";
import { requestBulkImport, type BulkImportFile } from "../actions/request-bulk-import";
import type { ImportCommitResult, ImportDryRun, ImportProduct, ImportRow } from "../lib/types";
import type { ExtractResult } from "../lib/extractRules";

const CSV_HEADERS = [
  "family",
  "model",
  "field_key",
  "label",
  "value_kind",
  "unit",
  "value",
  "scope",
  "sort",
] as const;

const TEMPLATE = [
  CSV_HEADERS.join(","),
  "Street Light,,ip_rating,IP Rating,text,,IP66,common,10",
  "Street Light,SL-100,luminous_flux,Luminous flux,number,lm,6000,model,40",
].join("\n");

/* --------------------------------------------------------------------------
   Inline CSV parser — handles quoted fields, embedded commas, escaped quotes
   ("") and CRLF/LF line endings.
   -------------------------------------------------------------------------- */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c === "\r") {
      // ignore — handled by the \n branch
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Map a parsed table (with a header row) to ImportRow[] by column name. */
function toImportRows(table: string[][]): { rows: ImportRow[]; error: string | null } {
  const nonEmpty = table.filter((r) => r.some((c) => c.trim() !== ""));
  if (nonEmpty.length === 0) return { rows: [], error: "The CSV is empty." };
  const header = nonEmpty[0].map((h) => h.trim().toLowerCase());
  const idx: Record<string, number> = {};
  for (const h of CSV_HEADERS) idx[h] = header.indexOf(h);
  const missing = CSV_HEADERS.filter((h) => idx[h] === -1);
  if (missing.length > 0) {
    return { rows: [], error: `Missing column(s): ${missing.join(", ")}. Use the template.` };
  }
  const at = (r: string[], k: (typeof CSV_HEADERS)[number]) => (r[idx[k]] ?? "").trim();
  const rows: ImportRow[] = nonEmpty.slice(1).map((r) => ({
    family: at(r, "family"),
    model: at(r, "model"),
    field_key: at(r, "field_key"),
    label: at(r, "label"),
    value_kind: at(r, "value_kind"),
    unit: at(r, "unit"),
    value: at(r, "value"),
    scope: at(r, "scope"),
    sort: at(r, "sort"),
  }));
  return { rows, error: null };
}

type PdfItem = { file: File; productId: string; version: string };
type Source = "pdf" | "csv" | "manual" | null;

// Bulk is now a background handoff: files are chosen (queued), uploaded, then
// handed to n8n (sent). Extraction / matching / import happen server-side and
// surface in the activity feed — not in this table.
type QueueStatus = "queued" | "uploading" | "sent" | "error";
type QueueItem = {
  id: string;
  file: File;
  status: QueueStatus;
  message?: string;
};

const QUEUE_CHIP: Record<QueueStatus, { label: string; bg: string; fg: string; bd: string }> = {
  queued: { label: "Ready", bg: "#f3f4f6", fg: "#6b7280", bd: "#e4e4e7" },
  uploading: { label: "Uploading…", bg: "#eef2ff", fg: "#3730a3", bd: "#c7d2fe" },
  sent: { label: "Queued for import", bg: "rgba(85,255,126,.16)", fg: "#0b7a39", bd: "#55ff7e" },
  error: { label: "Error", bg: "#fdecea", fg: "#a3281f", bd: "#f3b4ad" },
};

const inputMono = {
  width: "100%",
  padding: "10px 11px",
  border: "1px solid var(--sx-line-2, #dcdde1)",
  background: "#fff",
  font: "inherit" as const,
  fontSize: 12,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
};

export function ImportBaseline({ products }: { products: ImportProduct[] }) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [source, setSource] = useState<Source>(null);

  const [raw, setRaw] = useState("");
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportDryRun | null>(null);
  const [result, setResult] = useState<ImportCommitResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"preview" | "import" | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);

  // ---- Extract-from-PDF state ----
  const [extract, setExtract] = useState<ExtractResult | null>(null);
  const [extractErr, setExtractErr] = useState<string | null>(null);
  const [extractPending, startExtractTransition] = useTransition();
  const [extractFile, setExtractFile] = useState<File | null>(null);
  const extractRef = useRef<HTMLInputElement>(null);

  // ---- PDF attach state ----
  const [pdfItems, setPdfItems] = useState<PdfItem[]>([]);
  const [pdfMsg, setPdfMsg] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pdfPending, startPdfTransition] = useTransition();
  const pdfRef = useRef<HTMLInputElement>(null);
  // Set when the source PDF was auto-attached on import (source=pdf + matched).
  const [autoAttachMsg, setAutoAttachMsg] = useState<string | null>(null);

  // ---- Bulk PDF queue (Extract from PDF · Bulk → background import) ----
  const [pdfMode, setPdfMode] = useState<"single" | "bulk">("single");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkQueued, setBulkQueued] = useState<{ batchId: string; count: number } | null>(null);
  const queueRef = useRef<QueueItem[]>([]);

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  // The catalog product matching the extracted SKU (for auto-attach + browse link).
  const matchedProduct = useMemo(
    () => (extract?.sku ? products.find((p) => (p.sku ?? "").toLowerCase() === extract.sku!.toLowerCase()) : undefined),
    [extract, products]
  );
  const browseHref = matchedProduct
    ? `/productknowledgehub/${matchedProduct.categoryId}/${matchedProduct.id}`
    : "/productknowledgehub";

  function ingest(text: string) {
    setResult(null);
    setPreview(null);
    setError(null);
    const table = parseCsv(text);
    const { rows: parsed, error: err } = toImportRows(table);
    setParseError(err);
    setRows(err ? [] : parsed);
  }

  function onPaste(text: string) {
    setRaw(text);
    if (text.trim()) ingest(text);
    else {
      setRows([]);
      setParseError(null);
      setPreview(null);
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    const text = await file.text();
    setRaw(text);
    ingest(text);
  }

  function onExtractFile(file: File | undefined) {
    if (!file) return;
    setExtractErr(null);
    setExtract(null);
    setExtractFile(file);
    startExtractTransition(async () => {
      try {
        const supabase = createClient();
        const path = `spec-extract/${Date.now()}-${file.name}`;
        const { error: upErr } = await supabase.storage
          .from("documents")
          .upload(path, file, { contentType: "application/pdf", upsert: true });
        if (upErr) throw new Error(upErr.message);
        const res = await extractSpecSheet(path, file.name);
        setExtract(res);
        setRows(res.rows);
        setRaw("");
        setParseError(null);
        setPreview(null);
        setResult(null);
        setError(null);
        // Single-PDF: a successful extraction jumps straight to Step 2, which
        // auto-runs the dry-run preview — no "Continue to preview" click.
        if (res.family && res.rows.length > 0) {
          setStep(2);
        }
      } catch (e: any) {
        setExtractErr(e?.message ?? "Extraction failed.");
      }
    });
  }

  function downloadTemplate() {
    const href = "data:text/csv;charset=utf-8," + encodeURIComponent(TEMPLATE);
    const a = document.createElement("a");
    a.href = href;
    a.download = "knowledge-hub-baseline-template.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  /** Pick (or clear) the input source, resetting downstream state. */
  function selectSource(s: Source) {
    setSource(s);
    setPreview(null);
    setResult(null);
    setError(null);
    setExtract(null);
    setExtractErr(null);
    setExtractFile(null);
    setAutoAttachMsg(null);
    setPdfMode("single");
    setQueue([]);
    queueRef.current = [];
    setBulkBusy(false);
    setBulkError(null);
    setBulkQueued(null);
    if (s === "manual") {
      const hdr = CSV_HEADERS.join(",") + "\n";
      setRaw(hdr);
      ingest(hdr);
    } else {
      setRaw("");
      setRows([]);
      setParseError(null);
    }
  }

  function resetAll() {
    setStep(1);
    selectSource(null);
    setPdfItems([]);
    setPdfMsg(null);
    setPdfError(null);
  }

  function runPreview() {
    setError(null);
    setResult(null);
    startTransition(async () => {
      setBusy("preview");
      try {
        setPreview(await dryRunImport(rows));
      } catch (e: any) {
        setError(e?.message ?? "Preview failed.");
      } finally {
        setBusy(null);
      }
    });
  }

  function runImport() {
    setError(null);
    startTransition(async () => {
      setBusy("import");
      try {
        const summary = await importBaseline(rows);
        setResult(summary);
        setPreview(null);
        setStep(3);
        setAutoAttachMsg(null);
        // Source was a PDF — it IS the designed spec sheet, so attach it
        // automatically (no separate step). When the SKU matched a catalog
        // model we attach straight away; if it didn't match, fall back to the
        // manual attach card pre-loaded with the file so the rep can map it.
        if (source === "pdf" && extractFile) {
          if (matchedProduct) {
            const version = matchedProduct.currentVersion || "v1.0";
            try {
              await attachOne(extractFile, matchedProduct.id, version);
              setAutoAttachMsg(
                `Spec sheet attached automatically from the source PDF — ${matchedProduct.name} · ${version}.`
              );
            } catch (e: any) {
              setPdfItems([{ file: extractFile, productId: matchedProduct.id, version }]);
              setPdfError(`Couldn't auto-attach (${e?.message ?? "upload failed"}). Attach it manually below.`);
            }
          } else {
            setPdfItems([
              {
                file: extractFile,
                productId: products[0]?.id ?? "",
                version: products[0]?.currentVersion ?? "v1.0",
              },
            ]);
          }
        }
      } catch (e: any) {
        setError(e?.message ?? "Import failed.");
      } finally {
        setBusy(null);
      }
    });
  }

  // Step 2: auto-run the dry-run preview on entry — the rep shouldn't have to
  // click it. Fires once per entry (guarded on no preview yet + rows present).
  useEffect(() => {
    if (step === 2 && !preview && rows.length > 0 && busy === null) {
      runPreview();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // ---- PDF handlers ----
  function onPdfFiles(list: FileList | null) {
    if (!list) return;
    const defaultProduct = products[0];
    const next: PdfItem[] = Array.from(list).map((file) => ({
      file,
      productId: defaultProduct?.id ?? "",
      version: defaultProduct?.currentVersion ?? "v1.0",
    }));
    setPdfItems((prev) => [...prev, ...next]);
    setPdfMsg(null);
    setPdfError(null);
  }

  function setPdfProduct(i: number, productId: string) {
    setPdfItems((prev) =>
      prev.map((it, j) =>
        j === i ? { ...it, productId, version: productById.get(productId)?.currentVersion ?? "v1.0" } : it
      )
    );
  }

  function setPdfVersion(i: number, version: string) {
    setPdfItems((prev) => prev.map((it, j) => (j === i ? { ...it, version } : it)));
  }

  function removePdf(i: number) {
    setPdfItems((prev) => prev.filter((_, j) => j !== i));
  }

  /** Upload one PDF to storage + record it as the model's current spec sheet. */
  async function attachOne(file: File, productId: string, version: string) {
    const supabase = createClient();
    const v = (version || "v1.0").trim();
    const path = `spec-sheets/${productId}/${v}.pdf`;
    const { error: upErr } = await supabase.storage
      .from("documents")
      .upload(path, file, { contentType: "application/pdf", upsert: true });
    if (upErr) throw new Error(upErr.message);
    await recordUploadedSpecSheet(productId, v, path, file.name);
  }

  /** Merge a patch into one queue item. Updates the ref SYNCHRONOUSLY (so the
   *  processing loop sees status changes immediately) plus state for render. */
  function patchQueue(id: string, p: Partial<QueueItem>) {
    const next = queueRef.current.map((it) => (it.id === id ? { ...it, ...p } : it));
    queueRef.current = next;
    setQueue(next);
  }

  /** Add PDFs to the bulk queue (chosen, not yet sent). */
  function enqueuePdfs(list: FileList | null) {
    if (!list || list.length === 0) return;
    setBulkError(null);
    setBulkQueued(null);
    const items: QueueItem[] = Array.from(list).map((file, i) => ({
      id: `${Date.now()}-${i}-${file.name}`,
      file,
      status: "queued" as QueueStatus,
    }));
    const next = [...queueRef.current, ...items];
    queueRef.current = next;
    setQueue(next);
  }

  /**
   * Hand the whole batch to background import: upload each PDF to the documents
   * bucket, then call requestBulkImport — which signs each URL and emits
   * import.requested (→ n8n extracts, matches by SKU, imports, and calls back
   * /api/hooks/import-callback). Fire-and-return: the page can be closed and the
   * per-file result shows up in the activity feed.
   */
  function handoffBulk() {
    const items = queueRef.current.filter((it) => it.status === "queued" || it.status === "error");
    if (items.length === 0) return;
    setBulkBusy(true);
    setBulkError(null);
    setBulkQueued(null);
    startPdfTransition(async () => {
      try {
        const supabase = createClient();
        const files: BulkImportFile[] = [];
        for (const it of items) {
          patchQueue(it.id, { status: "uploading" });
          const path = `spec-import/${Date.now()}-${it.file.name}`;
          const { error: upErr } = await supabase.storage
            .from("documents")
            .upload(path, it.file, { contentType: "application/pdf", upsert: true });
          if (upErr) throw new Error(`Upload failed for ${it.file.name}: ${upErr.message}`);
          files.push({ storagePath: path, filename: it.file.name });
        }
        const res = await requestBulkImport(files);
        for (const it of items) patchQueue(it.id, { status: "sent" });
        setBulkQueued(res);
      } catch (e: any) {
        for (const it of items) patchQueue(it.id, { status: "error", message: e?.message ?? "Handoff failed." });
        setBulkError(e?.message ?? "Could not queue the batch.");
      } finally {
        setBulkBusy(false);
      }
    });
  }

  function removeQueueItem(id: string) {
    setQueue((prev) => {
      const next = prev.filter((it) => it.id !== id);
      queueRef.current = next;
      return next;
    });
  }

  function attachPdfs() {
    setPdfError(null);
    setPdfMsg(null);
    const ready = pdfItems.filter((it) => it.productId);
    if (ready.length === 0) {
      setPdfError("Pick a target model for each PDF first.");
      return;
    }
    startPdfTransition(async () => {
      try {
        const supabase = createClient();
        let done = 0;
        for (const it of ready) {
          const version = (it.version || "v1.0").trim();
          const path = `spec-sheets/${it.productId}/${version}.pdf`;
          const { error: upErr } = await supabase.storage
            .from("documents")
            .upload(path, it.file, { contentType: "application/pdf", upsert: true });
          if (upErr) throw new Error(upErr.message);
          await recordUploadedSpecSheet(it.productId, version, path, it.file.name);
          done += 1;
        }
        setPdfMsg(`Attached ${done} spec sheet${done === 1 ? "" : "s"}.`);
        setPdfItems([]);
        if (pdfRef.current) pdfRef.current.value = "";
      } catch (e: any) {
        setPdfError(e?.message ?? "Upload failed.");
      }
    });
  }

  const rowCount = rows.length;
  const unmatched = preview ? preview.familiesUnmatched.length + preview.productsUnmatched.length : 0;

  const STEPS = ["Choose source", "Preview", "Import"] as const;

  // Bulk is "done" once the batch has been handed off to background import.
  const queueDone = bulkQueued !== null;

  return (
    <>
      {/* ============ STEPPER (hidden in bulk — bulk is a single screen) ============ */}
      {source === "pdf" && pdfMode === "bulk" ? null : (
      <div className="card sec" style={{ padding: "12px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {STEPS.map((label, i) => {
            const n = (i + 1) as 1 | 2 | 3;
            const active = step === n;
            const done = step > n;
            return (
              <span key={label} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 7,
                    fontSize: 13,
                    fontWeight: active ? 600 : 400,
                    color: active ? "var(--sx-green-deep, #0b7a39)" : done ? "var(--sx-ink, #0f0f0f)" : "var(--sx-mute, #67646f)",
                  }}
                >
                  <span
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: "50%",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 11,
                      background: active
                        ? "var(--sx-green-deep, #0b7a39)"
                        : done
                        ? "var(--sx-green-tint, rgba(85,255,126,.14))"
                        : "var(--sx-line, #e7e7ea)",
                      color: active ? "#fff" : "var(--sx-ink, #0f0f0f)",
                    }}
                  >
                    {done ? "✓" : n}
                  </span>
                  {label}
                </span>
                {i < STEPS.length - 1 ? <span style={{ color: "var(--sx-mute-2, #aeaaba)" }}>›</span> : null}
              </span>
            );
          })}
        </div>
      </div>
      )}

      {/* ================= STEP 1 — CHOOSE SOURCE ================= */}
      {step === 1 && (
        <div className="card sec">
          <div className="sx-sectitle">
            <h2>Step 1 · Choose source</h2>
            {source ? (
              <div className="rhs" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {queueDone ? (
                  <button
                    className="sx-btn sx-btn-sm"
                    type="button"
                    onClick={() => {
                      setQueue([]);
                      queueRef.current = [];
                      setBulkQueued(null);
                      setBulkError(null);
                    }}
                  >
                    Import more
                  </button>
                ) : null}
                <button className="sx-btn sx-btn-sm" type="button" onClick={() => selectSource(null)}>
                  Change source
                </button>
              </div>
            ) : null}
          </div>

          {!source ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: 12,
                marginTop: 4,
              }}
            >
              <button
                type="button"
                className="card"
                onClick={() => selectSource("pdf")}
                style={{ textAlign: "left", padding: 14, cursor: "pointer", border: "1px solid var(--sx-line, #e7e7ea)" }}
              >
                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                  Extract from PDF <span className="px-sbadge published">beta</span>
                </div>
                <div className="sx-micro">Read spec values straight from a designed spec sheet. Fastest for one model.</div>
              </button>
              <button
                type="button"
                className="card"
                onClick={() => selectSource("csv")}
                style={{ textAlign: "left", padding: 14, cursor: "pointer", border: "1px solid var(--sx-line, #e7e7ea)" }}
              >
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Import a CSV</div>
                <div className="sx-micro">Upload or paste a CSV to add many models at once. Template provided.</div>
              </button>
              <button
                type="button"
                className="card"
                onClick={() => selectSource("manual")}
                style={{ textAlign: "left", padding: 14, cursor: "pointer", border: "1px solid var(--sx-line, #e7e7ea)" }}
              >
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Enter manually</div>
                <div className="sx-micro">Type values row by row, starting from the column template.</div>
              </button>
            </div>
          ) : null}

          {/* ---- PDF source ---- */}
          {source === "pdf" ? (
            <>
              <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "4px 0 12px", flexWrap: "wrap" }}>
                <div style={{ display: "inline-flex", gap: 6 }}>
                  <button
                    type="button"
                    className={pdfMode === "single" ? "sx-btn sx-btn-go sx-btn-sm" : "sx-btn sx-btn-sm"}
                    onClick={() => setPdfMode("single")}
                  >
                    Single
                  </button>
                  <button
                    type="button"
                    className={pdfMode === "bulk" ? "sx-btn sx-btn-go sx-btn-sm" : "sx-btn sx-btn-sm"}
                    onClick={() => setPdfMode("bulk")}
                  >
                    Bulk
                  </button>
                </div>
                <span className="sx-micro">
                  Rule-based · no OCR.
                  {pdfMode === "single" ? " One model per file." : " Many files — extracted, mapped and attached one-by-one."}
                </span>
              </div>

              {pdfMode === "bulk" ? (
                <>
                  <label
                    className="sx-btn sx-btn-sm"
                    style={{
                      cursor: bulkBusy ? "not-allowed" : "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      opacity: bulkBusy ? 0.6 : 1,
                    }}
                  >
                    <span>Choose PDFs…</span>
                    {queue.length > 0 ? (
                      <span className="sx-micro">
                        {queue.length} file{queue.length === 1 ? "" : "s"}
                      </span>
                    ) : null}
                    <input
                      type="file"
                      accept="application/pdf,.pdf"
                      multiple
                      disabled={bulkBusy}
                      onChange={(e) => enqueuePdfs(e.target.files)}
                      style={{ display: "none" }}
                    />
                  </label>
                  {queue.length === 0 ? (
                    <p className="sx-micro" style={{ marginTop: 8 }}>
                      Choose several PDFs, then send them for background import. Each is extracted, matched to its
                      model by SKU and imported by the automation — you can close this page and check progress in the
                      activity feed. Anything the matcher isn&apos;t sure about is flagged there as &ldquo;needs review&rdquo;.
                    </p>
                  ) : (
                    <div className="sx-panel" style={{ marginTop: 12 }}>
                      <table className="sx-list">
                        <thead>
                          <tr>
                            <th>PDF</th>
                            <th>Status</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {queue.map((q) => {
                            const chip = QUEUE_CHIP[q.status];
                            return (
                              <tr key={q.id}>
                                <td className="sx-micro">{q.file.name}</td>
                                <td>
                                  <span
                                    style={{
                                      display: "inline-block",
                                      borderRadius: 999,
                                      padding: "2px 9px",
                                      fontSize: 11,
                                      fontWeight: 700,
                                      background: chip.bg,
                                      color: chip.fg,
                                      border: `1px solid ${chip.bd}`,
                                    }}
                                    title={q.message ?? ""}
                                  >
                                    {chip.label}
                                  </span>
                                </td>
                                <td className="r">
                                  {!bulkBusy && q.status !== "sent" ? (
                                    <button className="sx-btn sx-btn-sm" type="button" onClick={() => removeQueueItem(q.id)}>
                                      Remove
                                    </button>
                                  ) : null}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>

                      {!bulkQueued ? (
                        <button
                          className="sx-btn sx-btn-go sx-btn-sm"
                          type="button"
                          style={{ marginTop: 10 }}
                          disabled={bulkBusy || !queue.some((q) => q.status === "queued" || q.status === "error")}
                          onClick={handoffBulk}
                        >
                          {bulkBusy
                            ? "Sending…"
                            : `Send ${queue.filter((q) => q.status === "queued" || q.status === "error").length} for background import`}
                        </button>
                      ) : null}

                      {bulkQueued ? (
                        <div
                          role="status"
                          aria-live="polite"
                          style={{
                            marginTop: 12,
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            background: "var(--sx-green-tint, rgba(85,255,126,.14))",
                            border: "1px solid rgba(85,255,126,.5)",
                            borderRadius: 8,
                            padding: "10px 12px",
                            color: "var(--sx-green-deep, #0b7a39)",
                            fontWeight: 600,
                            fontSize: 13,
                          }}
                        >
                          <span aria-hidden="true">✓</span>
                          {bulkQueued.count} file{bulkQueued.count === 1 ? "" : "s"} queued for background import. You can
                          close this page — progress appears in the activity feed.
                        </div>
                      ) : null}

                      {bulkError ? (
                        <p className="sx-micro" style={{ marginTop: 8, color: "#b42318" }}>
                          {bulkError}
                        </p>
                      ) : null}
                    </div>
                  )}
                </>
              ) : (
                <>
              <input
                ref={extractRef}
                type="file"
                accept="application/pdf,.pdf"
                disabled={extractPending}
                onChange={(e) => onExtractFile(e.target.files?.[0])}
              />
              {extractPending ? (
                <p className="sx-micro" style={{ marginTop: 8 }}>
                  Extracting…
                </p>
              ) : null}
              {extract && extract.family ? (
                <div style={{ marginTop: 10 }}>
                  <p className="sx-micro">
                    Detected <b>{extract.family}</b>
                    {extract.sku ? ` · ${extract.sku}` : ""} · {extract.rows.length} field
                    {extract.rows.length === 1 ? "" : "s"} read.
                  </p>
                  {extract.layoutSuspect ? (
                    <div className="card" style={{ marginTop: 8, padding: "10px 12px", borderLeft: "3px solid var(--sx-amber, #e8870e)" }}>
                      <div className="sx-micro" style={{ fontWeight: 600 }}>
                        {extract.missingRequired.length} required field
                        {extract.missingRequired.length === 1 ? "" : "s"} didn&apos;t match — the template may have changed
                      </div>
                      <div className="sx-micro" style={{ color: "var(--sx-amber-deep, #9a5a00)" }}>
                        Missing: {extract.missingRequired.join(", ")}. Fill these before importing, or flag to the dev team.
                      </div>
                    </div>
                  ) : null}
                  {extract.warnings.map((w, i) => (
                    <p key={i} className="sx-micro" style={{ marginTop: 6, color: "var(--sx-amber-deep, #9a5a00)" }}>
                      {w}
                    </p>
                  ))}
                </div>
              ) : extract && !extract.family ? (
                <p className="sx-micro" style={{ marginTop: 8, color: "var(--sx-amber-deep, #9a5a00)" }}>
                  {extract.warnings[0] ?? "No family matched this file."}
                </p>
              ) : null}
              {extractErr ? (
                <p className="sx-micro" style={{ marginTop: 8, color: "#b42318" }}>
                  {extractErr}
                </p>
              ) : null}
                </>
              )}
            </>
          ) : null}

          {/* ---- CSV / manual source ---- */}
          {source === "csv" || source === "manual" ? (
            <>
              <div className="sx-sectitle" style={{ marginTop: 4 }}>
                <span className="sx-micro">
                  Columns: <code>family, model, field_key, label, value_kind, unit, value, scope, sort</code>.
                </span>
                <div className="rhs">
                  <button className="sx-btn sx-btn-sm" type="button" onClick={downloadTemplate}>
                    Download CSV template
                  </button>
                </div>
              </div>
              {source === "csv" ? (
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", margin: "10px 0" }}>
                  <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} />
                </div>
              ) : null}
              <textarea
                value={raw}
                onChange={(e) => onPaste(e.target.value)}
                placeholder={source === "manual" ? "Type rows under the header line." : "…or paste CSV rows here (including the header line)."}
                rows={source === "manual" ? 8 : 6}
                style={{ ...inputMono, marginTop: source === "csv" ? 0 : 10 }}
              />
            </>
          ) : null}

          {/* status + continue */}
          {source ? (
            <>
              {parseError ? (
                <p className="sx-micro" style={{ color: "#b42318", marginTop: 8 }}>
                  {parseError}
                </p>
              ) : rowCount > 0 ? (
                <p className="sx-micro" style={{ marginTop: 8 }}>
                  {rowCount} data row{rowCount === 1 ? "" : "s"} ready.
                </p>
              ) : null}
              {source === "pdf" && pdfMode === "bulk" ? null : (
                <div style={{ marginTop: 14 }}>
                  <button
                    className="sx-btn sx-btn-go"
                    type="button"
                    disabled={rowCount === 0}
                    onClick={() => {
                      setPreview(null);
                      setStep(2);
                    }}
                    title={rowCount === 0 ? "Add some rows first" : ""}
                  >
                    Continue to preview →
                  </button>
                </div>
              )}
            </>
          ) : null}
        </div>
      )}

      {/* ================= STEP 2 — PREVIEW ================= */}
      {step === 2 && (
        <div className="card sec">
          <div className="sx-sectitle">
            <h2>Step 2 · Preview</h2>
            {preview ? (
              <div className="rhs">
                <span className="sx-micro">
                  {preview.fieldCount} field{preview.fieldCount === 1 ? "" : "s"} · {preview.valueCount} value
                  {preview.valueCount === 1 ? "" : "s"}
                </span>
              </div>
            ) : null}
          </div>

          <p className="sx-micro" style={{ marginBottom: 12 }}>
            Nothing is written yet. Run the dry run to check what matches, then import.
          </p>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button className="sx-btn" type="button" disabled={busy !== null} onClick={() => setStep(1)}>
              ← Back
            </button>
            <button className="sx-btn" type="button" disabled={busy !== null || rowCount === 0} onClick={runPreview}>
              {busy === "preview" ? "Working…" : preview ? "Re-run preview" : "Preview (dry run)"}
            </button>
            <button
              className="sx-btn sx-btn-go"
              type="button"
              disabled={busy !== null || !preview}
              onClick={runImport}
              title={!preview ? "Run the dry-run preview first" : ""}
            >
              {busy === "import" ? "Importing…" : "Import baseline →"}
            </button>
          </div>

          {busy ? (
            <div
              role="status"
              aria-live="polite"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginTop: 12,
                padding: "10px 12px",
                borderRadius: 8,
                background: "#eef6ff",
                border: "1px solid #bcd9f5",
                color: "#1f4e79",
                fontSize: 13,
              }}
            >
              <style>{"@keyframes sx-spin{to{transform:rotate(360deg)}}"}</style>
              <span
                aria-hidden="true"
                style={{
                  width: 14,
                  height: 14,
                  flex: "0 0 auto",
                  border: "2px solid #bcd9f5",
                  borderTopColor: "#1f4e79",
                  borderRadius: "50%",
                  animation: "sx-spin 0.7s linear infinite",
                }}
              />
              {busy === "import"
                ? `Importing baseline… writing ${preview?.valueCount ?? rowCount} value${
                    (preview?.valueCount ?? rowCount) === 1 ? "" : "s"
                  } across ${preview?.familiesMatched.length ?? 0} families. This can take up to a minute — keep this tab open.`
                : "Checking what matches… one moment."}
            </div>
          ) : null}

          {error ? (
            <p className="sx-micro" style={{ color: "#b42318", marginTop: 10 }}>
              {error}
            </p>
          ) : null}

          {preview ? (
            <div style={{ marginTop: 14 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 12 }}>
                <div className="card" style={{ padding: "12px 14px" }}>
                  <div style={{ fontSize: 22, fontWeight: 700 }}>{preview.familiesMatched.length}</div>
                  <div className="sx-micro">Families matched</div>
                </div>
                <div className="card" style={{ padding: "12px 14px" }}>
                  <div style={{ fontSize: 22, fontWeight: 700 }}>{preview.productsMatched}</div>
                  <div className="sx-micro">Models matched</div>
                </div>
                <div
                  className="card"
                  style={{ padding: "12px 14px", borderLeft: unmatched > 0 ? "3px solid var(--sx-amber, #e8870e)" : undefined }}
                >
                  <div style={{ fontSize: 22, fontWeight: 700 }}>{unmatched}</div>
                  <div className="sx-micro">Won&apos;t import (unmatched)</div>
                </div>
              </div>

              {preview.familiesMatched.length > 0 ? (
                <p className="sx-micro" style={{ marginTop: 12 }}>
                  Matched families: {preview.familiesMatched.join(", ")}
                </p>
              ) : null}
              {preview.familiesUnmatched.length > 0 ? (
                <p className="sx-micro" style={{ marginTop: 8, color: "var(--sx-amber-deep, #9a5a00)" }}>
                  Unmatched families (skipped): {preview.familiesUnmatched.join(", ")}
                </p>
              ) : null}
              {preview.productsUnmatched.length > 0 ? (
                <div className="sx-panel" style={{ marginTop: 12 }}>
                  <table className="sx-list">
                    <thead>
                      <tr>
                        <th>Family</th>
                        <th>Model (not found — skipped)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.productsUnmatched.map((p, i) => (
                        <tr key={`${p.family}-${p.model}-${i}`}>
                          <td>{p.family}</td>
                          <td>
                            <span className="px-sbadge archived">{p.model}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              {preview.warnings.length > 0 ? (
                <div style={{ marginTop: 12 }}>
                  <div className="sx-micro" style={{ fontWeight: 600, marginBottom: 4 }}>
                    Warnings ({preview.warnings.length})
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {preview.warnings.map((w, i) => (
                      <li key={i} className="sx-micro" style={{ color: "var(--sx-amber-deep, #9a5a00)" }}>
                        {w}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}

      {/* ================= STEP 3 — IMPORT DONE + ATTACH ================= */}
      {step === 3 && (
        <>
          <div className="card sec">
            <div className="sx-sectitle">
              <h2>Step 3 · Import complete</h2>
              <div className="rhs" style={{ display: "flex", gap: 8 }}>
                <a className="sx-btn sx-btn-go" href={browseHref}>
                  View in Browse specs →
                </a>
                <button className="sx-btn sx-btn-sm" type="button" onClick={resetAll}>
                  Import another
                </button>
              </div>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: "var(--sx-green-tint, rgba(85,255,126,.14))",
                border: "1px solid rgba(85,255,126,.5)",
                borderRadius: 8,
                padding: "10px 12px",
                margin: "4px 0 12px",
                color: "var(--sx-green-deep, #0b7a39)",
                fontWeight: 600,
                fontSize: 14,
              }}
            >
              <span aria-hidden="true">✓</span> Import complete — your specs are saved to the Knowledge Hub.
            </div>
            {autoAttachMsg ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  background: "var(--sx-green-tint, rgba(85,255,126,.14))",
                  border: "1px solid rgba(85,255,126,.5)",
                  borderRadius: 8,
                  padding: "10px 12px",
                  margin: "0 0 12px",
                  color: "var(--sx-green-deep, #0b7a39)",
                  fontWeight: 600,
                  fontSize: 14,
                }}
              >
                <span aria-hidden="true">✓</span> {autoAttachMsg}
              </div>
            ) : null}
            {result ? (
              <>
                <p className="sx-sub">
                  Saved to the Knowledge Hub. {result.families} famil{result.families === 1 ? "y" : "ies"} ·{" "}
                  {result.fields} field{result.fields === 1 ? "" : "s"} · {result.values} value
                  {result.values === 1 ? "" : "s"} written. View it in Browse specs, or import another sheet.
                </p>
                {result.skipped.length > 0 ? (
                  <div style={{ marginTop: 8 }}>
                    <div className="sx-micro" style={{ fontWeight: 600, marginBottom: 4 }}>
                      Skipped ({result.skipped.length})
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {result.skipped.map((s, i) => (
                        <li key={i} className="sx-micro" style={{ color: "var(--sx-amber-deep, #9a5a00)" }}>
                          {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>

          {/* ---- Attach designed spec sheets ----
              Hidden when the source PDF was auto-attached (source=pdf + matched);
              stays available (optional) for CSV / manual imports and for a PDF
              whose SKU didn't match a catalog model. */}
          {autoAttachMsg ? null : (
          <div className="card sec">
            <div className="sx-sectitle">
              <h2>Attach designed spec sheets (optional)</h2>
              <div className="rhs">
                <span className="sx-micro">Uploads a PDF as a model&apos;s current spec sheet</span>
              </div>
            </div>

            {products.length === 0 ? (
              <div className="sx-empty">No products available to attach to.</div>
            ) : (
              <>
                {pdfItems.length > 0 ? (
                  <p className="sx-micro" style={{ marginBottom: 10, color: "var(--sx-green-deep, #0b7a39)" }}>
                    The sheet you extracted from is ready below, mapped to its model — just click <b>Attach spec sheets</b>. Or add more files.
                  </p>
                ) : null}
                <input
                  ref={pdfRef}
                  type="file"
                  accept="application/pdf,.pdf"
                  multiple
                  onChange={(e) => onPdfFiles(e.target.files)}
                />

                {pdfItems.length > 0 ? (
                  <div className="sx-panel" style={{ marginTop: 12 }}>
                    <table className="sx-list">
                      <thead>
                        <tr>
                          <th>PDF</th>
                          <th>Target model</th>
                          <th>Version</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {pdfItems.map((it, i) => (
                          <tr key={i}>
                            <td className="sx-micro">{it.file.name}</td>
                            <td>
                              <select
                                value={it.productId}
                                onChange={(e) => setPdfProduct(i, e.target.value)}
                                style={{ font: "inherit", fontSize: 12, padding: "4px 6px" }}
                              >
                                {products.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.familyName} · {p.name}
                                    {p.sku ? ` (${p.sku})` : ""}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td>
                              <input
                                value={it.version}
                                onChange={(e) => setPdfVersion(i, e.target.value)}
                                style={{
                                  font: "inherit",
                                  fontSize: 12,
                                  padding: "4px 6px",
                                  width: 80,
                                  border: "1px solid var(--sx-line-2, #dcdde1)",
                                }}
                              />
                            </td>
                            <td className="r">
                              <button className="sx-btn" type="button" onClick={() => removePdf(i)}>
                                Remove
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}

                <div style={{ marginTop: 12 }}>
                  <button className="sx-btn sx-btn-go" type="button" disabled={pdfPending || pdfItems.length === 0} onClick={attachPdfs}>
                    {pdfPending ? "Uploading…" : "Attach spec sheets"}
                  </button>
                </div>

                {pdfMsg ? (
                  <p className="sx-micro" style={{ marginTop: 8, color: "var(--sx-green-deep, #0b7a39)" }}>
                    {pdfMsg}
                  </p>
                ) : null}
                {pdfError ? (
                  <p className="sx-micro" style={{ marginTop: 8, color: "#b42318" }}>
                    {pdfError}
                  </p>
                ) : null}
              </>
            )}
          </div>
          )}
        </>
      )}
    </>
  );
}

export default ImportBaseline;
