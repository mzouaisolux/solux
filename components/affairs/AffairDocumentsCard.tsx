"use client";

// =====================================================================
// Documents — the project's SINGLE SOURCE OF TRUTH (owner spec 2026-07-07).
// Every document related to the project, from every module, in ONE place:
// folder-organised (Commercial / Study Lab / Technical / Production /
// Logistics / Customer Files), searchable, with uniform actions. Generated
// documents are first-class rows exactly like uploads. The aggregation
// itself lives in lib/project-documents-server.ts — this component just
// renders whatever the repository contains.
//
// Fallback: when a caller doesn't provide `repository` (not wired yet),
// the legacy flat list still renders so no surface ever goes blank.
// =====================================================================

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AffairFile } from "@/lib/affairs-prototype";
import {
  filterProjectDocuments,
  repositoryAuthors,
  groupByFolder,
  DOC_STATUS_LABEL,
  DOC_STATUS_TONE,
  type ProjectDocStatus,
  type ProjectDocument,
  type ProjectFolder,
  PROJECT_FOLDERS,
} from "@/lib/project-documents";
import { setProjectDocumentStatus } from "@/app/(app)/_actions/project-doc-status";
import { createDocumentShareLink } from "@/app/(app)/_actions/project-doc-share";
import { pushToast } from "@/components/feedback/toast-store";
import { AttachmentUploader } from "@/components/attachments/AttachmentUploader";
import { AttachmentDeleteButton } from "@/components/attachments/AttachmentDeleteButton";
import { AttachmentReplaceButton } from "@/components/affairs/AttachmentReplaceButton";
import {
  AssignDocumentPanel,
  type AssignableDoc,
} from "@/components/affairs/AssignDocumentPanel";

const ACT = "text-[11px] font-medium text-neutral-500 hover:text-neutral-900";

function fmtD(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** Draft/Approved/Final pill — plus an inline setter for those who may. */
function DocStatusControl({
  d,
  canSet,
}: {
  d: ProjectDocument;
  canSet: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  if (!d.docStatus) return null;
  const source = d.source === "attachment" ? "attachment" : "order_document";

  if (!canSet || !d.sourceId) {
    return (
      <span
        className={`inline-flex items-center rounded border px-1.5 py-px text-[10px] font-semibold ${DOC_STATUS_TONE[d.docStatus]}`}
      >
        {DOC_STATUS_LABEL[d.docStatus]}
      </span>
    );
  }
  return (
    <select
      value={d.docStatus}
      disabled={pending}
      onChange={(e) => {
        const fd = new FormData();
        fd.set("source", source);
        fd.set("id", d.sourceId!);
        fd.set("status", e.target.value);
        startTransition(async () => {
          try {
            await setProjectDocumentStatus(fd);
            pushToast(`Status → ${DOC_STATUS_LABEL[e.target.value as ProjectDocStatus]}`);
            router.refresh();
          } catch (err: any) {
            pushToast(err?.message ?? "Status change failed", "error");
          }
        });
      }}
      className={`rounded border px-1 py-px text-[10px] font-semibold ${DOC_STATUS_TONE[d.docStatus]} cursor-pointer disabled:opacity-50`}
      aria-label="Document status"
    >
      {(Object.keys(DOC_STATUS_LABEL) as ProjectDocStatus[]).map((s) => (
        <option key={s} value={s}>
          {DOC_STATUS_LABEL[s]}
        </option>
      ))}
    </select>
  );
}

/** Copy a share link: signed URL (7 days) for files, the page URL for records. */
function ShareButton({ d }: { d: ProjectDocument }) {
  const [pending, startTransition] = useTransition();
  if (!d.share && d.source !== "record" && d.source !== "quotation") return null;
  const copy = () => {
    startTransition(async () => {
      try {
        const url = d.share
          ? (await createDocumentShareLink(d.share.source, d.share.id, d.share.extra)).url
          : `${window.location.origin}${d.href}`;
        await navigator.clipboard.writeText(url);
        pushToast(d.share ? "🔗 Link copied — valid 7 days" : "🔗 Page link copied");
      } catch (e: any) {
        pushToast(e?.message ?? "Share failed", "error");
      }
    });
  };
  return (
    <button type="button" onClick={copy} disabled={pending} className={ACT}>
      {pending ? "…" : "Share"}
    </button>
  );
}

function DocRow({ d, canSetDocStatus }: { d: ProjectDocument; canSetDocStatus: boolean }) {
  const isExternal = d.source !== "record" && d.source !== "quotation";
  const meta = [
    d.kindLabel,
    d.author,
    fmtD(d.date),
    !d.isCurrent ? "previous version" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <li className={`flex items-center gap-2.5 py-2 ${d.isCurrent ? "" : "opacity-60"}`}>
      <span className="text-[13px] leading-none" aria-hidden>
        📄
      </span>
      <div className="min-w-0 flex-1">
        <a
          href={d.href}
          {...(isExternal ? { target: "_blank", rel: "noreferrer" } : {})}
          className="block truncate text-[12.5px] font-medium text-neutral-800 hover:text-neutral-950 hover:underline"
          title={`${d.name} — ${meta}`}
        >
          {d.name}
        </a>
        <div className="truncate text-[10.5px] text-neutral-400">{meta}</div>
      </div>
      {d.version != null && d.source === "order_document" && (
        <span className="text-[10px] font-semibold uppercase text-neutral-400">
          v{d.version}
          {d.isCurrent ? " · current" : ""}
        </span>
      )}
      <DocStatusControl d={d} canSet={canSetDocStatus} />
      {d.status && (
        <span className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">
          {d.status}
        </span>
      )}
      {d.sizeLabel && (
        <span className="text-[11px] text-neutral-400">{d.sizeLabel}</span>
      )}
      <div className="flex shrink-0 items-center gap-2.5">
        <a
          href={d.href}
          {...(isExternal ? { target: "_blank", rel: "noreferrer" } : {})}
          className={ACT}
        >
          Open
        </a>
        {d.downloadHref && (
          <a href={d.downloadHref} download={d.name} className={ACT}>
            Download
          </a>
        )}
        <ShareButton d={d} />
        {d.attachmentId && d.documentId && (
          <AttachmentReplaceButton
            attachmentId={d.attachmentId}
            documentId={d.documentId}
            attachmentType={d.attachmentType}
          />
        )}
        {d.attachmentId && d.documentId && (
          <AttachmentDeleteButton
            id={d.attachmentId}
            documentId={d.documentId}
            fileName={d.name}
          />
        )}
      </div>
    </li>
  );
}

export function AffairDocumentsCard({
  files,
  affairId,
  documentId,
  taskListId,
  productionOrderId,
  assignableDocs = [],
  repository,
  canSetDocStatus = false,
}: {
  files: AffairFile[];
  affairId: string;
  documentId: string | null;
  taskListId: string | null;
  productionOrderId: string | null;
  assignableDocs?: AssignableDoc[];
  /** SSoT repository (loadProjectRepositories). Absent → legacy flat list. */
  repository?: ProjectDocument[];
  /** hasUiCapability("document.set_status") — shows the status setter. */
  canSetDocStatus?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState("");
  const [folder, setFolder] = useState<ProjectFolder | null>(null);
  const [author, setAuthor] = useState("");
  const [latestOnly, setLatestOnly] = useState(true);
  // Folders start open — the point is to SEE everything at a glance;
  // users collapse what they don't need (state kept per folder).
  const [closed, setClosed] = useState<Record<string, boolean>>({});

  const repo = repository ?? null;
  const authorsList = useMemo(() => (repo ? repositoryAuthors(repo) : []), [repo]);
  const hasHistory = useMemo(() => (repo ? repo.some((d) => !d.isCurrent) : false), [repo]);
  const filtered = useMemo(
    () =>
      repo
        ? filterProjectDocuments(repo, q, folder, {
            author: author || null,
            latestOnly,
          })
        : [],
    [repo, q, folder, author, latestOnly]
  );
  const groups = useMemo(() => groupByFolder(filtered), [filtered]);
  const count = repo
    ? repo.filter((d) => d.isCurrent).length
    : files.filter((f) => f.kind === "attachment").length +
      (taskListId ? 1 : 0) +
      (productionOrderId ? 1 : 0);

  return (
    <section>
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
          Documents
          <span className="ml-1.5 font-normal text-neutral-400">{count}</span>
        </h3>
        {documentId && (
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="text-[11px] font-medium text-neutral-600 hover:text-neutral-900"
          >
            {adding ? "Close" : "+ Add file"}
          </button>
        )}
      </div>

      {/* ------------------- SSoT repository rendering ------------------- */}
      {repo ? (
        <>
          {repo.length === 0 ? (
            <p className="mt-2 text-[12px] text-neutral-400">
              No documents yet — quotations, studies, production and shipping
              files all land here automatically as the project progresses.
            </p>
          ) : (
            <>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search documents…"
                  className="w-48 rounded-md border border-neutral-200 bg-white px-2 py-1 text-[11.5px] placeholder:text-neutral-400 focus:border-neutral-400 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setFolder(null)}
                  className={`rounded-md px-1.5 py-0.5 text-[10.5px] font-medium ${
                    folder === null
                      ? "bg-neutral-900 text-white"
                      : "text-neutral-500 hover:text-neutral-900"
                  }`}
                >
                  All
                </button>
                {PROJECT_FOLDERS.filter((f) =>
                  repo.some((d) => d.folder === f.key)
                ).map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setFolder(folder === f.key ? null : f.key)}
                    className={`rounded-md px-1.5 py-0.5 text-[10.5px] font-medium ${
                      folder === f.key
                        ? "bg-neutral-900 text-white"
                        : "text-neutral-500 hover:text-neutral-900"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
                {authorsList.length > 0 && (
                  <select
                    value={author}
                    onChange={(e) => setAuthor(e.target.value)}
                    className="rounded-md border border-neutral-200 bg-white px-1.5 py-0.5 text-[10.5px] text-neutral-600 focus:border-neutral-400 focus:outline-none"
                    aria-label="Filter by uploader"
                  >
                    <option value="">Anyone</option>
                    {authorsList.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                )}
                {hasHistory && (
                  <label className="flex cursor-pointer items-center gap-1 text-[10.5px] text-neutral-500">
                    <input
                      type="checkbox"
                      checked={latestOnly}
                      onChange={(e) => setLatestOnly(e.target.checked)}
                      className="h-3 w-3"
                    />
                    Latest only
                  </label>
                )}
              </div>

              {groups.length === 0 ? (
                <p className="mt-2 text-[12px] text-neutral-400">
                  No document matches the current search.
                </p>
              ) : (
                <div className="mt-1">
                  {groups.map(({ folder: f, docs }) => (
                    <div key={f.key} className="border-t border-neutral-100">
                      <button
                        type="button"
                        onClick={() =>
                          setClosed((m) => ({ ...m, [f.key]: !m[f.key] }))
                        }
                        className="flex w-full items-center gap-1.5 py-2 text-left"
                      >
                        <span className="text-[12px]" aria-hidden>
                          {f.emoji}
                        </span>
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-600">
                          {f.label}
                        </span>
                        <span className="text-[11px] text-neutral-400">
                          {docs.length}
                        </span>
                        <span className="ml-auto text-[10px] text-neutral-300">
                          {closed[f.key] ? "▸" : "▾"}
                        </span>
                      </button>
                      {!closed[f.key] && (
                        <ul className="divide-y divide-neutral-50 pb-1 pl-5">
                          {docs.map((d) => (
                            <DocRow key={d.key} d={d} canSetDocStatus={canSetDocStatus} />
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      ) : (
        /* ------------------ legacy flat list (fallback) ------------------ */
        <ul className="mt-1 divide-y divide-neutral-100 border-t border-neutral-100">
          {taskListId && (
            <li className="flex items-center gap-2.5 py-2">
              <span className="text-[13px] leading-none" aria-hidden>📄</span>
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-neutral-800">Task List</span>
              <Link href={`/task-lists/${taskListId}`} className={ACT}>Open</Link>
            </li>
          )}
          {productionOrderId && (
            <li className="flex items-center gap-2.5 py-2">
              <span className="text-[13px] leading-none" aria-hidden>📄</span>
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-neutral-800">Production Order</span>
              <Link href={`/production/orders/${productionOrderId}`} className={ACT}>Open</Link>
            </li>
          )}
          {files
            .filter((f) => f.kind === "attachment")
            .map((f) => (
              <li key={f.key} className="flex items-center gap-2.5 py-2">
                <span className="text-[13px] leading-none" aria-hidden>📄</span>
                <a href={f.href} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-neutral-800 hover:underline" title={f.name}>
                  {f.name}
                </a>
                {f.sizeLabel && <span className="text-[11px] text-neutral-400">{f.sizeLabel}</span>}
                <div className="flex shrink-0 items-center gap-2.5">
                  <a href={f.href} target="_blank" rel="noreferrer" className={ACT}>Open</a>
                  {f.downloadHref && <a href={f.downloadHref} download={f.name} className={ACT}>Download</a>}
                  {f.attachmentId && f.documentId && (
                    <AttachmentReplaceButton attachmentId={f.attachmentId} documentId={f.documentId} attachmentType={f.attachmentType} />
                  )}
                  {f.attachmentId && f.documentId && (
                    <AttachmentDeleteButton id={f.attachmentId} documentId={f.documentId} fileName={f.name} />
                  )}
                </div>
              </li>
            ))}
        </ul>
      )}

      {adding && documentId && (
        <div className="mt-2">
          <AttachmentUploader documentId={documentId} affairId={documentId} />
        </div>
      )}

      {/* Assign existing quotation — minimized (disclosure). */}
      {assignableDocs.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[11px] font-medium text-neutral-400 hover:text-neutral-600">
            Assign existing quotation
          </summary>
          <div className="mt-1.5">
            <AssignDocumentPanel affairId={affairId} docs={assignableDocs} />
          </div>
        </details>
      )}
    </section>
  );
}
