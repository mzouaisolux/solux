"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/components/feedback/toast-store";
import type { ProductOption, StagedDocDTO, CommitResult } from "@/lib/import/dto";
import { AttentionCard } from "./AttentionCard";
import { createImportBatch, extractOneInvoice, commitBatch } from "./actions";

type Cat = { id: string; name: string };
type Phase = "pending" | "uploading" | "extracting" | "done" | "failed";
type FileState = { key: string; fileName: string; phase: Phase; doc?: StagedDocDTO; error?: string };
type Step = "drop" | "processing" | "review" | "done";

const CONCURRENCY = 3;
const STEPS: { key: Step; label: string }[] = [
  { key: "drop", label: "Upload" },
  { key: "processing", label: "Reading" },
  { key: "review", label: "Review" },
  { key: "done", label: "Done" },
];

function money(v: number | null, cur: string | null): string {
  if (v == null) return "—";
  return `${cur ? cur + " " : ""}${v.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function ImportWizard({
  clientId,
  clientName,
  clientCode,
  products,
  categories,
}: {
  clientId: string;
  clientName: string;
  clientCode: string | null;
  products: ProductOption[];
  categories: Cat[];
}) {
  const [step, setStep] = useState<Step>("drop");
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [states, setStates] = useState<FileState[]>([]);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<CommitResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ---- derived ----
  const docs = useMemo(
    () => states.filter((s) => s.doc).map((s) => s.doc!) as StagedDocDTO[],
    [states]
  );
  const ready = docs.filter((d) => d.status === "staged");
  const attention = docs.filter((d) => d.status === "needs_attention");
  const duplicates = docs.filter((d) => d.status === "duplicate");
  const failed = states.filter((s) => s.phase === "failed");
  const processed = states.filter((s) => s.phase === "done" || s.phase === "failed").length;

  const yearsRange = useMemo(() => {
    const years = docs
      .map((d) => (d.date ? d.date.slice(0, 4) : null))
      .filter(Boolean) as string[];
    if (years.length === 0) return null;
    const sorted = years.sort();
    return sorted[0] === sorted[sorted.length - 1]
      ? sorted[0]
      : `${sorted[0]}–${sorted[sorted.length - 1]}`;
  }, [docs]);

  // ---- file intake ----
  function addFiles(list: FileList | null) {
    if (!list) return;
    const pdfs = Array.from(list).filter(
      (f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")
    );
    if (pdfs.length === 0) {
      toast.error("Please drop PDF invoices.");
      return;
    }
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => f.name + f.size));
      const merged = [...prev];
      for (const f of pdfs) if (!seen.has(f.name + f.size)) merged.push(f);
      return merged;
    });
  }

  function patch(key: string, partial: Partial<FileState>) {
    setStates((prev) => prev.map((s) => (s.key === key ? { ...s, ...partial } : s)));
  }
  function updateDoc(dto: StagedDocDTO) {
    setStates((prev) => prev.map((s) => (s.doc?.id === dto.id ? { ...s, doc: dto } : s)));
  }

  // ---- run the import (upload + extract, throttled) ----
  async function startImport() {
    if (files.length === 0) return;
    const supabase = createClient();

    let bId: string;
    try {
      const r = await createImportBatch(clientId, files.length);
      bId = r.batchId;
      setBatchId(bId);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not start the import.");
      return;
    }

    const initial: FileState[] = files.map((f, i) => ({
      key: `${i}-${f.name}-${f.size}`,
      fileName: f.name,
      phase: "pending",
    }));
    setStates(initial);
    setStep("processing");

    let idx = 0;
    const runOne = async () => {
      while (idx < files.length) {
        const my = idx++;
        const file = files[my];
        const key = initial[my].key;
        patch(key, { phase: "uploading" });
        const safe = file.name.replace(/[^a-zA-Z0-9._-]+/g, "_");
        const path = `imports/${clientId}/${bId}/${my}-${safe}`;
        const { error: upErr } = await supabase.storage
          .from("documents")
          .upload(path, file, { upsert: true, contentType: file.type || "application/pdf" });
        if (upErr) {
          patch(key, { phase: "failed", error: upErr.message });
          continue;
        }
        patch(key, { phase: "extracting" });
        try {
          const dto = await extractOneInvoice({ batchId: bId, storagePath: path, fileName: file.name });
          patch(key, { phase: "done", doc: dto });
        } catch (e: any) {
          patch(key, { phase: "failed", error: e?.message ?? "Extraction failed" });
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, files.length) }, () => runOne())
    );
    setStep("review");
  }

  async function doCommit() {
    if (!batchId) return;
    setCommitting(true);
    try {
      const r = await commitBatch(batchId);
      setResult(r);
      setStep("done");
      toast.success(`Imported ${r.imported} invoice${r.imported === 1 ? "" : "s"}`);
    } catch (e: any) {
      toast.error(e?.message ?? "Import failed.");
    } finally {
      setCommitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-8 space-y-6">
      {/* header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="eyebrow">Historical invoice import</div>
          <h1 className="doc-title mt-1">{clientName}</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Rebuild {clientName}&rsquo;s commercial history from old PDF invoices.
          </p>
        </div>
        <Link href={`/clients/${clientId}`} className="btn-secondary">
          ← Back to customer
        </Link>
      </div>

      <Stepper step={step} />

      {/* ---------- STEP: DROP ---------- */}
      {step === "drop" && (
        <div className="space-y-4">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              addFiles(e.dataTransfer.files);
            }}
            onClick={() => inputRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-12 text-center transition-colors ${
              dragOver
                ? "border-solux bg-solux-muted"
                : "border-neutral-300 bg-neutral-50/50 hover:border-neutral-400"
            }`}
          >
            <UploadGlyph />
            <div className="mt-3 text-sm font-semibold text-neutral-800">
              Drop {clientName}&rsquo;s invoices here
            </div>
            <div className="mt-1 text-[12px] text-neutral-500">
              1 to 200 PDFs · all assumed to belong to this customer
            </div>
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,.pdf"
              multiple
              className="hidden"
              onChange={(e) => addFiles(e.target.files)}
            />
          </div>

          {files.length > 0 && (
            <div className="panel p-4">
              <div className="flex items-center justify-between">
                <div className="eyebrow">
                  {files.length} file{files.length > 1 ? "s" : ""} ready
                </div>
                <button
                  type="button"
                  onClick={() => setFiles([])}
                  className="btn-ghost text-[12px] text-neutral-500"
                >
                  Clear
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {files.map((f, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-2 py-0.5 text-[11px] text-neutral-600"
                  >
                    <span className="max-w-[180px] truncate">{f.name}</span>
                    <button
                      type="button"
                      onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                      className="text-neutral-400 hover:text-neutral-700"
                      aria-label="Remove"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <div className="mt-4 flex justify-end">
                <button type="button" onClick={startImport} className="btn-primary">
                  Rebuild history from {files.length} invoice{files.length > 1 ? "s" : ""}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---------- STEP: PROCESSING ---------- */}
      {(step === "processing" || step === "review") && (
        <div className="grid grid-cols-3 gap-3">
          <Counter label="Detected" value={docs.length} />
          <Counter label="Ready" value={ready.length} tone="emerald" />
          <Counter label="Need attention" value={attention.length} tone="amber" />
        </div>
      )}

      {step === "processing" && (
        <div className="panel p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="eyebrow">Reading invoices…</div>
            <div className="text-[12px] tabular-nums text-neutral-500">
              {processed}/{states.length}
            </div>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
            <div
              className="h-full rounded-full bg-solux transition-all"
              style={{ width: `${states.length ? (processed / states.length) * 100 : 0}%` }}
            />
          </div>
          <ul className="mt-1 divide-y divide-neutral-100">
            {states.map((s) => (
              <li key={s.key} className="flex items-center justify-between gap-2 py-1.5">
                <span className="truncate text-[12px] text-neutral-700">{s.fileName}</span>
                <PhaseBadge state={s} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ---------- STEP: REVIEW ---------- */}
      {step === "review" && (
        <div className="space-y-4">
          <div className="panel p-4">
            <p className="text-sm text-neutral-700">
              <span className="font-semibold">{docs.length}</span> invoices detected ·{" "}
              <span className="font-semibold text-emerald-700">{ready.length} ready</span>
              {attention.length > 0 && (
                <>
                  {" "}
                  · <span className="font-semibold text-amber-700">{attention.length} to fix</span>
                </>
              )}
              {duplicates.length > 0 && <> · {duplicates.length} already imported</>}
              {failed.length > 0 && <> · {failed.length} unreadable</>}
            </p>
            <p className="mt-1 text-[12px] text-neutral-500">
              Only fix the flagged items below — everything else imports automatically.
            </p>
          </div>

          {attention.map((d) => (
            <AttentionCard
              key={d.id}
              doc={d}
              clientName={clientName}
              products={products}
              categories={categories}
              onUpdate={updateDoc}
            />
          ))}

          {ready.length > 0 && (
            <div className="panel p-4">
              <div className="eyebrow mb-2">{ready.length} ready to import</div>
              <ul className="divide-y divide-neutral-100">
                {ready.slice(0, 60).map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-2 py-1.5">
                    <span className="flex items-center gap-2 min-w-0">
                      <CheckGlyph />
                      <span className="font-mono text-[12px] text-neutral-800">
                        {d.number ?? d.fileName ?? "—"}
                      </span>
                    </span>
                    <span className="text-[12px] tabular-nums text-neutral-500">
                      {[d.date, money(d.total, d.currency)].filter(Boolean).join(" · ")}
                    </span>
                  </li>
                ))}
              </ul>
              {ready.length > 60 && (
                <div className="mt-1 text-[11px] text-neutral-400">
                  +{ready.length - 60} more…
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <Link href={`/clients/${clientId}`} className="btn-secondary">
              Cancel
            </Link>
            <button
              type="button"
              disabled={committing || ready.length === 0}
              onClick={doCommit}
              className="btn-primary"
            >
              {committing
                ? "Importing…"
                : `Import ${ready.length} invoice${ready.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      )}

      {/* ---------- STEP: DONE ---------- */}
      {step === "done" && result && (
        <div className="panel p-8 text-center space-y-3">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
            <CheckGlyph className="h-6 w-6 text-emerald-600" />
          </div>
          <h2 className="text-xl font-semibold text-neutral-900">
            {result.imported} invoice{result.imported === 1 ? "" : "s"} imported
          </h2>
          <p className="text-sm text-neutral-500">
            {yearsRange
              ? `${clientName}'s commercial history for ${yearsRange} is now rebuilt.`
              : `${clientName}'s commercial history is now available.`}
            {result.remainingAttention > 0 &&
              ` ${result.remainingAttention} invoice(s) still need attention.`}
          </p>
          <div className="flex items-center justify-center gap-2 pt-2">
            <Link href={`/clients/${clientId}?tab=history`} className="btn-primary">
              View customer history
            </Link>
            <Link href={`/clients/${clientId}/import-invoices`} className="btn-secondary">
              Import more
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// small presentational pieces
// ---------------------------------------------------------------------------

function Stepper({ step }: { step: Step }) {
  const activeIdx = STEPS.findIndex((s) => s.key === step);
  return (
    <div className="flex items-center gap-2">
      {STEPS.map((s, i) => {
        const done = i < activeIdx;
        const active = i === activeIdx;
        return (
          <div key={s.key} className="flex items-center gap-2">
            <div
              className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold ${
                active
                  ? "bg-solux text-white"
                  : done
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-neutral-100 text-neutral-400"
              }`}
            >
              {done ? "✓" : i + 1}
            </div>
            <span
              className={`text-[12px] font-medium ${
                active ? "text-neutral-900" : "text-neutral-400"
              }`}
            >
              {s.label}
            </span>
            {i < STEPS.length - 1 && <span className="mx-1 h-px w-6 bg-neutral-200" />}
          </div>
        );
      })}
    </div>
  );
}

function Counter({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "emerald" | "amber";
}) {
  const cls =
    tone === "emerald" ? "text-emerald-700" : tone === "amber" ? "text-amber-700" : "text-neutral-900";
  return (
    <div className="panel p-4">
      <div className="eyebrow">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${cls}`}>{value}</div>
    </div>
  );
}

function PhaseBadge({ state }: { state: FileState }) {
  if (state.phase === "done") {
    const st = state.doc?.status;
    if (st === "needs_attention")
      return <span className="pill border-amber-300 bg-amber-100 text-amber-800">⚠ Attention</span>;
    if (st === "duplicate")
      return <span className="pill border-neutral-300 bg-neutral-100 text-neutral-600">Already imported</span>;
    return <span className="pill border-emerald-300 bg-emerald-100 text-emerald-700">✓ Ready</span>;
  }
  if (state.phase === "failed")
    return (
      <span className="pill border-rose-300 bg-rose-100 text-rose-700" title={state.error}>
        Unreadable
      </span>
    );
  if (state.phase === "extracting")
    return <span className="pill border-neutral-200 bg-white text-neutral-500">Reading…</span>;
  if (state.phase === "uploading")
    return <span className="pill border-neutral-200 bg-white text-neutral-500">Uploading…</span>;
  return <span className="pill border-neutral-200 bg-white text-neutral-400">Queued</span>;
}

function UploadGlyph() {
  return (
    <svg className="h-8 w-8 text-neutral-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 16V4m0 0 4 4m-4-4L8 8" />
      <path d="M20 16v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2" />
    </svg>
  );
}

function CheckGlyph({ className = "h-4 w-4 text-emerald-600" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
