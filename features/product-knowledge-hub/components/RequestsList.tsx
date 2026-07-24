"use client";

/**
 * Change-requests list (Section 14) with inline actions.
 *
 * Read-side: filter by status. Write-side, gated by capability + status:
 *   - operations (spec.raise): Submit a draft for approval.
 *   - task_list_manager (spec.approve): open a Review panel to upload the
 *     engineer-signed document (Storage + attachSignedDocument), then Approve
 *     (refused server-side without a signed doc) or Reject with a reason.
 *
 * All buttons call the existing server actions — no logic is duplicated here.
 */

import { Fragment, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  submitRequest,
  attachSignedDocument,
  approveRequest,
  rejectRequest,
} from "../actions";
import type { ChangeRequestRow } from "../lib/read";
import type { SpecChangeRequestStatus, SpecDiffEntry } from "../lib/types";

/** One side of a diff entry → a readable "value unit" (or —). */
function fmtDiffSide(
  v: { value_number: number | null; value_text: string | null } | null,
  unit: string | null
): string {
  if (!v) return "—";
  const raw = v.value_number != null ? String(v.value_number) : (v.value_text ?? "");
  if (!raw) return "—";
  return unit ? `${raw} ${unit}` : raw;
}

/**
 * Serialize a published CR's diff into a hand-off file: a readable summary an
 * admin can paste into a Claude/Figma session to update the glossy datasheet,
 * plus the raw JSON for precision. Pure — no DOM.
 */
function buildChangesFile(r: ChangeRequestRow): string {
  const diff = (r.diff ?? []) as SpecDiffEntry[];
  const ver = r.version_to ?? "";
  const out: string[] = [];
  out.push(`# ${r.familyName ?? "Family"} — spec changes ${ver}`.trim());
  if (r.reason) out.push(`Reason: ${r.reason}`);
  out.push(`Fields changed: ${diff.length}`);
  out.push("");
  for (const d of diff) {
    const scope = d.product_id ? `model ${d.product_id}` : "common";
    out.push(`- [${scope}] ${d.label}: ${fmtDiffSide(d.from, d.unit)} → ${fmtDiffSide(d.to, d.unit)}`);
  }
  out.push("");
  out.push("```json");
  out.push(JSON.stringify(diff, null, 2));
  out.push("```");
  return out.join("\n");
}

const STATUS_META: Record<SpecChangeRequestStatus, { label: string; bg: string; fg: string }> = {
  draft: { label: "Draft", bg: "#eef0f3", fg: "#4b5563" },
  submitted: { label: "Submitted", bg: "#fef3e2", fg: "#b45309" },
  waiting_approval: { label: "Waiting approval", bg: "#fef3e2", fg: "#b45309" },
  approved: { label: "Approved", bg: "#e6f4ea", fg: "#166534" },
  published: { label: "Published", bg: "#e6f4ea", fg: "#166534" },
  rejected: { label: "Rejected", bg: "#fdecec", fg: "#b91c1c" },
};

const FILTERS: ("all" | SpecChangeRequestStatus)[] = [
  "all",
  "draft",
  "submitted",
  "waiting_approval",
  "approved",
  "published",
  "rejected",
];

function StatusBadge({ status }: { status: SpecChangeRequestStatus }) {
  const m = STATUS_META[status];
  return (
    <span style={{ background: m.bg, color: m.fg, padding: "2px 8px", borderRadius: 20, fontSize: 12, fontWeight: 600 }}>
      {m.label}
    </span>
  );
}

/**
 * Glossy-datasheet (.fig → PDF) status for a published CR. "In the oven" =
 * the designed sheet still needs redoing/re-uploading for some affected model
 * (amber, Manuel's to-do); "Served" = every affected model's sheet is done
 * (green). Auto-flips when the plugin upload lands. Non-published rows show —.
 */
function DatasheetBadge({ r }: { r: ChangeRequestRow }) {
  if (r.status !== "published" || !r.datasheetState) {
    return <span style={{ color: "#9ca3af" }}>—</span>;
  }
  const cooking = r.datasheetState === "cooking";
  return (
    <span
      title={
        cooking
          ? "The glossy Figma datasheet still needs to be redone and re-uploaded for the affected model(s). Auto-clears when the plugin upload lands."
          : "The glossy Figma datasheet has been refreshed for every affected model at this version."
      }
      style={{
        background: cooking ? "#fef3e2" : "#e6f4ea",
        color: cooking ? "#b45309" : "#166534",
        padding: "2px 8px",
        borderRadius: 20,
        fontSize: 12,
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      {cooking ? `In the oven${r.datasheetTotal > 1 ? ` · ${r.datasheetDone}/${r.datasheetTotal}` : ""}` : "Served ✓"}
    </span>
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function RequestsList({
  requests,
  canRaise,
  canApprove,
}: {
  requests: ChangeRequestRow[];
  canRaise: boolean;
  canApprove: boolean;
}) {
  const [filter, setFilter] = useState<"all" | SpecChangeRequestStatus>("all");
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [signer, setSigner] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();

  const filtered = useMemo(
    () => (filter === "all" ? requests : requests.filter((r) => r.status === filter)),
    [requests, filter]
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: requests.length };
    for (const r of requests) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [requests]);

  function run(id: string, fn: () => Promise<unknown>, ok: string) {
    setError(null);
    setMessage(null);
    setBusyId(id);
    startTransition(async () => {
      try {
        await fn();
        setMessage(ok);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      } finally {
        setBusyId(null);
      }
    });
  }

  function handleSubmit(r: ChangeRequestRow) {
    run(r.id, () => submitRequest(r.id), "Submitted for approval.");
  }

  /** Download the published CR's changes as a hand-off file (for Claude/Figma). */
  function downloadChanges(r: ChangeRequestRow) {
    const blob = new Blob([buildChangesFile(r)], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const fam = (r.familyName ?? "family").replace(/\s+/g, "-").toLowerCase();
    a.download = `spec-changes-${fam}-${r.version_to ?? "v"}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function handleAttach(r: ChangeRequestRow) {
    if (!file) {
      setError("Choose a signed document file first.");
      return;
    }
    if (!signer.trim()) {
      setError("Enter the signer's name.");
      return;
    }
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    const kind: "pdf" | "excel" = isPdf ? "pdf" : "excel";
    const path = `signed-docs/${r.id}/${file.name}`;
    run(
      r.id,
      async () => {
        const supabase = createClient();
        const { error: upErr } = await supabase.storage
          .from("documents")
          .upload(path, file, { contentType: file.type || undefined, upsert: true });
        if (upErr) throw new Error(upErr.message);
        await attachSignedDocument(r.id, { path, name: file.name, kind, signer: signer.trim() });
        setFile(null);
      },
      "Signed document attached — you can approve now."
    );
  }

  function handleApprove(r: ChangeRequestRow) {
    run(
      r.id,
      async () => {
        await approveRequest(r.id);
        setReviewId(null);
      },
      "Approved and published."
    );
  }

  function handleReject(r: ChangeRequestRow) {
    const reason = prompt("Reason for rejecting this change request?");
    if (reason == null) return;
    run(
      r.id,
      async () => {
        await rejectRequest(r.id, reason);
        setReviewId(null);
      },
      "Rejected — sent back to draft."
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Status filter */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className="sx-clear"
            style={{
              padding: "4px 10px",
              borderRadius: 20,
              fontSize: 12,
              fontWeight: filter === f ? 700 : 500,
              background: filter === f ? "var(--sx-mauve, #4a4560)" : "#eef0f3",
              color: filter === f ? "#fff" : "#4b5563",
            }}
          >
            {f === "all" ? "All" : STATUS_META[f].label} ({counts[f] ?? 0})
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="sx-sub">No change requests {filter === "all" ? "yet" : `with status "${filter}"`}.</p>
      ) : (
        <div className="card sec" style={{ padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--sx-text-2, #6b6d76)", background: "var(--sx-lilac, #f6f5f9)" }}>
                <th style={{ padding: "8px 10px" }}>Family</th>
                <th style={{ padding: "8px 10px" }}>Reason</th>
                <th style={{ padding: "8px 10px" }}>Changes</th>
                <th style={{ padding: "8px 10px" }}>Raised by</th>
                <th style={{ padding: "8px 10px" }}>Created</th>
                <th style={{ padding: "8px 10px" }}>Status</th>
                <th style={{ padding: "8px 10px" }}>Datasheet</th>
                <th style={{ padding: "8px 10px" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const changes = (r.diff ?? []).length;
                const isReviewing = reviewId === r.id;
                const rowBusy = busyId === r.id && pending;
                const canReview = canApprove && (r.status === "submitted" || r.status === "waiting_approval");
                return (
                  <Fragment key={r.id}>
                    <tr style={{ borderTop: "1px solid #eee" }}>
                      <td style={{ padding: "8px 10px" }}>
                        {r.category_id ? (
                          <Link href={`/productknowledgehub/${r.category_id}`} className="sx-link">
                            {r.familyName ?? "family"}
                          </Link>
                        ) : (
                          r.familyName ?? "—"
                        )}
                      </td>
                      <td style={{ padding: "8px 10px", maxWidth: 260 }}>{r.reason || <span style={{ color: "#9ca3af" }}>—</span>}</td>
                      <td style={{ padding: "8px 10px" }}>
                        {changes} change{changes === 1 ? "" : "s"}
                        {r.modelCount > 0 ? ` · ${r.modelCount} model${r.modelCount === 1 ? "" : "s"}` : ""}
                      </td>
                      <td style={{ padding: "8px 10px" }}>{r.authorLabel ?? "—"}</td>
                      <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>{fmtDate(r.created_at)}</td>
                      <td style={{ padding: "8px 10px" }}><StatusBadge status={r.status} /></td>
                      <td style={{ padding: "8px 10px" }}><DatasheetBadge r={r} /></td>
                      <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                        {canRaise && r.status === "draft" && (
                          <button type="button" className="sx-btn sx-btn-go" onClick={() => handleSubmit(r)} disabled={rowBusy}>
                            {rowBusy ? "…" : "Submit"}
                          </button>
                        )}
                        {canReview && (
                          <button type="button" className="sx-btn" onClick={() => setReviewId(isReviewing ? null : r.id)} disabled={rowBusy}>
                            {isReviewing ? "Close" : "Review"}
                          </button>
                        )}
                        {r.status === "published" && changes > 0 && (
                          <button type="button" className="sx-btn" onClick={() => downloadChanges(r)} title="Download the changes as a hand-off file for the glossy datasheet edit">
                            Download changes
                          </button>
                        )}
                        {!canRaise && !canReview && !(r.status === "published" && changes > 0) && (
                          <span style={{ color: "#9ca3af" }}>—</span>
                        )}
                      </td>
                    </tr>
                    {isReviewing && canReview && (
                      <tr style={{ background: "var(--sx-lilac, #f6f5f9)" }}>
                        <td colSpan={8} style={{ padding: "12px 14px" }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 640 }}>
                            <div className="sx-micro" style={{ fontWeight: 700 }}>
                              Review — approval needs an engineer-signed document
                            </div>
                            {r.signed_doc_path ? (
                              <div className="sx-micro" style={{ color: "#166534" }}>
                                Signed: {r.signed_doc_name}{r.signer_name ? ` · ${r.signer_name}` : ""} — ready to approve.
                              </div>
                            ) : (
                              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                                <input
                                  type="text"
                                  value={signer}
                                  onChange={(e) => setSigner(e.target.value)}
                                  placeholder="Signer name"
                                  style={{ padding: 6, border: "1px solid #dcdde1", fontSize: 13 }}
                                />
                                <input
                                  type="file"
                                  accept=".pdf,application/pdf,.xlsx,.xls"
                                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                                  style={{ fontSize: 12 }}
                                />
                                <button type="button" className="sx-btn" onClick={() => handleAttach(r)} disabled={rowBusy}>
                                  {rowBusy ? "Uploading…" : "Attach signed doc"}
                                </button>
                              </div>
                            )}
                            <div style={{ display: "flex", gap: 10 }}>
                              <button
                                type="button"
                                className="sx-btn sx-btn-go"
                                onClick={() => handleApprove(r)}
                                disabled={rowBusy || !r.signed_doc_path}
                                title={r.signed_doc_path ? "Approve & publish" : "Attach a signed document first"}
                              >
                                Approve &amp; publish
                              </button>
                              <button type="button" className="sx-clear" onClick={() => handleReject(r)} disabled={rowBusy} style={{ color: "#b91c1c" }}>
                                Reject
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {error ? <span className="sx-micro" style={{ color: "#b91c1c" }}>{error}</span> : null}
      {message ? <span className="sx-micro" style={{ color: "#166534" }}>{message}</span> : null}
    </div>
  );
}
