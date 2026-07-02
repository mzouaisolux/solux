"use client";

import { useState } from "react";
import { toast } from "@/components/feedback/toast-store";
import type { ProductOption, StagedDocDTO, StagedLineDTO } from "@/lib/import/dto";
import { ProductPicker } from "./ProductPicker";
import {
  resolveLineMapping,
  setNameDecision,
  acknowledgeIntegrity,
  skipDocument,
} from "./actions";

type Cat = { id: string; name: string };

function money(v: number | null, cur: string | null): string {
  if (v == null) return "—";
  return `${cur ? cur + " " : ""}${v.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function AttentionCard({
  doc,
  clientName,
  products,
  categories,
  onUpdate,
}: {
  doc: StagedDocDTO;
  clientName: string;
  products: ProductOption[];
  categories: Cat[];
  onUpdate: (dto: StagedDocDTO) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [remember, setRemember] = useState(true);

  async function run(fn: () => Promise<StagedDocDTO>, okMsg?: string) {
    setBusy(true);
    try {
      const dto = await fn();
      onUpdate(dto);
      if (okMsg) toast.success(okMsg);
    } catch (e: any) {
      toast.error(e?.message ?? "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const scope = remember ? "client" : "none";
  const nameUnresolved =
    !doc.nameMatches && doc.nameDecision !== "forced" && doc.nameDecision !== "confirmed";
  const integrityUnresolved = !doc.integrityReconciles && !doc.integrityAck;
  const unknownLines = doc.lines.filter((l) => l.needsReview);

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-4 space-y-3">
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[13px] font-semibold text-neutral-900">
              {doc.number ?? "(no number)"}
            </span>
            <span className="pill border-amber-300 bg-amber-100 text-amber-800">
              Needs attention
            </span>
          </div>
          <div className="mt-0.5 text-[11px] text-neutral-500">
            {[doc.fileName, doc.date, money(doc.total, doc.currency)]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => run(() => skipDocument(doc.id), "Invoice skipped")}
          className="btn-ghost text-[12px] text-neutral-500"
        >
          Skip this invoice
        </button>
      </div>

      {/* customer mismatch */}
      {nameUnresolved && (
        <div className="rounded-lg border border-neutral-200 bg-white p-3">
          <div className="text-[12px] font-semibold text-neutral-800">
            This document appears to belong to another customer.
          </div>
          <div className="mt-0.5 text-[11px] text-neutral-500">
            Detected on the invoice:{" "}
            <span className="font-medium text-neutral-700">
              {doc.detectedCustomer || "—"}
            </span>{" "}
            · opened customer: <span className="font-medium text-neutral-700">{clientName}</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => setNameDecision(doc.id, "confirmed"), "Confirmed customer")}
              className="btn-secondary text-[12px]"
            >
              This is {clientName}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => setNameDecision(doc.id, "forced"))}
              className="btn-ghost text-[12px]"
            >
              Import anyway
            </button>
          </div>
        </div>
      )}

      {/* integrity warning */}
      {integrityUnresolved && (
        <div className="rounded-lg border border-neutral-200 bg-white p-3">
          <div className="text-[12px] font-semibold text-neutral-800">
            Some figures could not be verified.
          </div>
          <ul className="mt-1 list-disc pl-4 text-[11px] text-neutral-500 space-y-0.5">
            {doc.attentionReasons
              .filter((r) => !r.toLowerCase().includes("customer") && !r.toLowerCase().includes("unknown product"))
              .slice(0, 4)
              .map((r, i) => (
                <li key={i}>{r}</li>
              ))}
          </ul>
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => acknowledgeIntegrity(doc.id))}
            className="btn-ghost mt-2 text-[12px]"
          >
            Import anyway
          </button>
        </div>
      )}

      {/* unknown products */}
      {unknownLines.length > 0 && (
        <div className="rounded-lg border border-neutral-200 bg-white p-3 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="text-[12px] font-semibold text-neutral-800">
              {unknownLines.length} unknown product{unknownLines.length > 1 ? "s" : ""}
            </div>
            <label className="flex items-center gap-1.5 text-[11px] text-neutral-500">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="h-3 w-3"
              />
              Remember for next time
            </label>
          </div>
          {unknownLines.map((line) => (
            <UnknownLineRow
              key={line.id}
              doc={doc}
              line={line}
              products={products}
              categories={categories}
              scope={scope}
              busy={busy}
              onResolved={onUpdate}
              setBusy={setBusy}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function UnknownLineRow({
  doc,
  line,
  products,
  categories,
  scope,
  busy,
  onResolved,
  setBusy,
}: {
  doc: StagedDocDTO;
  line: StagedLineDTO;
  products: ProductOption[];
  categories: Cat[];
  scope: "client" | "none";
  busy: boolean;
  onResolved: (dto: StagedDocDTO) => void;
  setBusy: (b: boolean) => void;
}) {
  const [legacyOpen, setLegacyOpen] = useState(false);
  const [legacyName, setLegacyName] = useState(line.description);
  const [legacyCat, setLegacyCat] = useState<string>("");

  async function resolve(
    action: "map" | "legacy" | "ignore",
    extra?: { productId?: string; legacyName?: string; legacyCategoryId?: string }
  ) {
    setBusy(true);
    try {
      const dto = await resolveLineMapping({
        importedDocumentId: doc.id,
        lineId: line.id,
        action,
        remember: scope,
        ...extra,
      });
      onResolved(dto);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not resolve the line");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-md border border-neutral-100 bg-neutral-50/60 p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[12px] font-medium text-neutral-800">
            {line.description || "(no description)"}
          </div>
          <div className="text-[10.5px] text-neutral-400">
            qty {line.quantity ?? "—"} · {money(line.lineTotal, doc.currency)}
          </div>
        </div>
      </div>

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <ProductPicker
          products={products}
          placeholder="Match with existing product…"
          onPick={(p) => resolve("map", { productId: p.id })}
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => setLegacyOpen((v) => !v)}
            className="btn-xs"
          >
            Create legacy
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => resolve("ignore")}
            className="btn-xs"
          >
            Ignore
          </button>
        </div>
      </div>

      {/* suggestion shortcut */}
      {line.suggestion && (
        <button
          type="button"
          disabled={busy}
          onClick={() => resolve("map", { productId: line.suggestion!.id })}
          className="mt-1.5 text-[11px] font-medium text-green-deep hover:underline"
        >
          Use suggestion: {line.suggestion.name} ({Math.round(line.suggestion.score * 100)}%)
        </button>
      )}

      {/* legacy create inline form */}
      {legacyOpen && (
        <div className="mt-2 rounded-md border border-neutral-200 bg-white p-2 space-y-1.5">
          <input
            className="input-sm"
            value={legacyName}
            onChange={(e) => setLegacyName(e.target.value)}
            placeholder="Legacy product name"
          />
          <div className="flex items-center gap-2">
            <select
              className="input-sm"
              value={legacyCat}
              onChange={(e) => setLegacyCat(e.target.value)}
            >
              <option value="">— category (optional) —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                resolve("legacy", {
                  legacyName: legacyName.trim() || line.description,
                  legacyCategoryId: legacyCat || undefined,
                })
              }
              className="btn-primary text-[12px] whitespace-nowrap"
            >
              Create &amp; link
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
