"use client";

// =====================================================================
// Documents — the project's SINGLE SOURCE OF TRUTH (owner spec 2026-07-07).
// Every document related to the project, from every module, in ONE place:
// organised into categories (Commercial / Customer Files / Technical /
// Energy & Lighting Studies / Drawings / Certifications / Photos / Shipping /
// Contracts / Other), searchable, with uniform actions. Generated documents
// are first-class rows exactly like uploads. The aggregation itself lives in
// lib/project-documents-server.ts — this component just renders it.
//
// m164 — uploaded files can be re-filed by DRAG & DROP between categories:
// every category stays visible as a drop target (even empty), the move is
// optimistic + persisted to attachments.folder. Generated documents keep
// their business-derived category and aren't draggable.
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
  folderLabel,
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
import { moveAttachmentToFolder } from "@/app/(app)/_actions/attachments";
import { AttachmentDeleteButton } from "@/components/attachments/AttachmentDeleteButton";
import { AttachmentReplaceButton } from "@/components/affairs/AttachmentReplaceButton";
import { PreviewOverlay } from "@/components/documents/PreviewOverlay";
import {
  AssignDocumentPanel,
  type AssignableDoc,
} from "@/components/affairs/AssignDocumentPanel";
import { SendButton } from "@/components/delivery/SendButton";
import { NavGlyph, InlineIcon } from "@/components/NavIcons";
import { DocSummaryPreview, DocThumb } from "@/components/affairs/DocPreview";

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

/** Inline preview overlay (PDFs & images). */
function PreviewButton({ d }: { d: ProjectDocument }) {
  const [open, setOpen] = useState(false);
  // What to render in the overlay:
  //   • commercial docs (quotation/proforma/order confirmation) → the
  //     GENERATED PDF (downloadHref), not the editor page (href);
  //   • uploads → the signed file URL (href).
  // Records have no file, and a commercial doc with no PDF yet has no
  // downloadHref → no button at all (nothing to show).
  const previewSrc = d.source === "quotation" ? d.downloadHref : d.href;
  if (d.source === "record" || !previewSrc) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={ACT}>
        Preview
      </button>
      {open && (
        <PreviewOverlay
          src={previewSrc}
          title={d.name}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function DocRow({
  d,
  canSetDocStatus,
  affairId,
  movable = false,
  onDragStart,
  onDragEnd,
  dragging = false,
}: {
  d: ProjectDocument;
  canSetDocStatus: boolean;
  affairId: string;
  /** Only uploaded files carry a user-editable category → draggable. */
  movable?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  dragging?: boolean;
}) {
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
    <li
      draggable={movable}
      onDragStart={
        movable
          ? (e) => {
              e.dataTransfer.effectAllowed = "move";
              onDragStart?.();
            }
          : undefined
      }
      onDragEnd={movable ? onDragEnd : undefined}
      className={`flex items-center gap-2.5 py-2 transition-all duration-200 ${
        d.isCurrent ? "" : "opacity-60"
      } ${movable ? "cursor-grab active:cursor-grabbing" : ""} ${
        dragging ? "opacity-40" : ""
      }`}
      title={movable ? "Drag to another category to re-file" : undefined}
    >
      {/* Thumbnail when we can render the file, else the existing type icon. */}
      {d.preview && (d.preview.kind === "image" || d.preview.kind === "pdf") ? (
        <DocThumb d={d} />
      ) : (
        <span className="sx-doc-ic" aria-hidden>
          <NavGlyph name="doc" />
        </span>
      )}
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
        {/* Commercial docs: amount · products · date — tells V1 from V2. */}
        <DocSummaryPreview d={d} />
      </div>
      {d.version != null &&
        (d.source === "order_document" || d.source === "attachment") && (
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
        <PreviewButton d={d} />
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
        {d.downloadHref && (
          <SendButton
            projectDocuments={[d]}
            affairId={affairId}
            label={<><InlineIcon name="envelope" /> Send</>}
            className={ACT}
            title="Prepare an email with this document attached"
          />
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
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState("");
  const [folder, setFolder] = useState<ProjectFolder | null>(null);
  const [author, setAuthor] = useState("");
  const [latestOnly, setLatestOnly] = useState(true);
  // Folders start open — the point is to SEE everything at a glance;
  // users collapse what they don't need (state kept per folder).
  const [closed, setClosed] = useState<Record<string, boolean>>({});

  // ----- Drag & drop re-categorisation (m164) -----
  // `moved` = optimistic overrides (attachmentId → folder) applied on top of
  // the server repository so a dropped file jumps categories instantly; the
  // server refresh reconciles it. `draggingId` = the row in flight;
  // `dropTarget` = the category currently hovered (for the highlight).
  const [moved, setMoved] = useState<Record<string, ProjectFolder>>({});
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<ProjectFolder | null>(null);

  const repo = repository ?? null;
  const authorsList = useMemo(() => (repo ? repositoryAuthors(repo) : []), [repo]);
  const hasHistory = useMemo(() => (repo ? repo.some((d) => !d.isCurrent) : false), [repo]);
  // Apply optimistic category moves before anything else reads the repo.
  const repoMoved = useMemo(
    () =>
      repo
        ? repo.map((d) =>
            d.attachmentId && moved[d.attachmentId]
              ? { ...d, folder: moved[d.attachmentId] }
              : d
          )
        : null,
    [repo, moved]
  );
  const filtered = useMemo(
    () =>
      repoMoved
        ? filterProjectDocuments(repoMoved, q, folder, {
            author: author || null,
            latestOnly,
          })
        : [],
    [repoMoved, q, folder, author, latestOnly]
  );
  // Default organising view (no search / author filter) shows EVERY category
  // as a visible drop target — even empty ones. A search narrows to matches.
  const includeEmpty = q.trim() === "" && author === "";
  const groups = useMemo(
    () => groupByFolder(filtered, includeEmpty),
    [filtered, includeEmpty]
  );

  // A file is movable only if it's a current uploaded attachment.
  function isMovable(d: ProjectDocument): boolean {
    return d.source === "attachment" && !!d.attachmentId && d.isCurrent;
  }

  function onDropInto(target: ProjectFolder) {
    setDropTarget(null);
    const id = draggingId;
    setDraggingId(null);
    if (!id) return;
    const doc = repoMoved?.find((d) => d.attachmentId === id);
    if (!doc || !doc.documentId) return;
    const current = doc.folder;
    if (current === target) return; // no-op drop onto the same category

    // Optimistic: move now, reconcile on the server.
    setMoved((m) => ({ ...m, [id]: target }));
    const fd = new FormData();
    fd.set("id", id);
    fd.set("document_id", doc.documentId);
    fd.set("folder", target);
    moveAttachmentToFolder(fd)
      .then(() => {
        pushToast(`Moved to ${folderLabel(target)}`);
        router.refresh();
      })
      .catch((e: any) => {
        // Revert the optimistic move and tell the user why.
        setMoved((m) => {
          const next = { ...m };
          delete next[id];
          return next;
        });
        pushToast(e?.message ?? "Could not move the document", "error");
      });
  }
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
        <div className="flex items-center gap-3">
          {/* Send Documents — the generic assistant: pick any of the project's
              documents + a recipient, one email. Only when something is
              actually attachable. */}
          {repo && repo.some((d) => d.downloadHref) && (
            <SendButton
              projectDocuments={repo}
              affairId={affairId}
              preselectedIds={[]}
              label={<><InlineIcon name="envelope" /> Send documents</>}
              className="sx-send-btn"
              title="Prepare an email with any of this project's documents"
            />
          )}
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
                  {groups.map(({ folder: f, docs }) => {
                    const isTarget = dropTarget === f.key;
                    // A hovered category during a drag becomes a highlighted
                    // drop zone; a valid drag always expands the section so the
                    // target is visible even if the user had collapsed it.
                    const collapsed = !!closed[f.key] && !draggingId;
                    return (
                    <div
                      key={f.key}
                      onDragOver={(e) => {
                        if (!draggingId) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        if (dropTarget !== f.key) setDropTarget(f.key);
                      }}
                      onDragLeave={(e) => {
                        // Only clear when the pointer actually left the section.
                        if (!e.currentTarget.contains(e.relatedTarget as Node))
                          setDropTarget((t) => (t === f.key ? null : t));
                      }}
                      onDrop={(e) => {
                        if (!draggingId) return;
                        e.preventDefault();
                        onDropInto(f.key);
                      }}
                      className={`rounded-lg border-t border-neutral-100 transition-colors ${
                        isTarget
                          ? "border-transparent bg-solux/5 ring-2 ring-solux/40 ring-inset"
                          : draggingId
                          ? "border-transparent ring-1 ring-dashed ring-neutral-200 ring-inset"
                          : ""
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setClosed((m) => ({ ...m, [f.key]: !m[f.key] }))
                        }
                        className="flex w-full items-center gap-1.5 py-2 pl-1 text-left"
                      >
                        <span className="sx-cat-ic" aria-hidden>
                          <NavGlyph name={f.icon} />
                        </span>
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-600">
                          {f.label}
                        </span>
                        <span className="text-[11px] text-neutral-400">
                          {docs.length}
                        </span>
                        {isTarget && (
                          <span className="text-[10px] font-semibold text-solux">
                            Drop to move here
                          </span>
                        )}
                        <span className="ml-auto text-[10px] text-neutral-300">
                          {collapsed ? "▸" : "▾"}
                        </span>
                      </button>
                      {!collapsed && (
                        docs.length === 0 ? (
                          <p className="px-1 pb-2 pl-6 text-[11px] italic text-neutral-300">
                            {draggingId ? "Drop files here" : "No documents yet"}
                          </p>
                        ) : (
                        <ul className="divide-y divide-neutral-50 pb-1 pl-5">
                          {docs.map((d) => (
                            <DocRow
                            key={d.key}
                            d={d}
                            canSetDocStatus={canSetDocStatus}
                            affairId={affairId}
                            movable={isMovable(d)}
                            dragging={draggingId === d.attachmentId}
                            onDragStart={() => setDraggingId(d.attachmentId)}
                            onDragEnd={() => {
                              setDraggingId(null);
                              setDropTarget(null);
                            }}
                          />
                          ))}
                        </ul>
                        )
                      )}
                    </div>
                    );
                  })}
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
              <span className="sx-doc-ic" aria-hidden><NavGlyph name="doc" /></span>
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-neutral-800">Task List</span>
              <Link href={`/task-lists/${taskListId}`} className={ACT}>Open</Link>
            </li>
          )}
          {productionOrderId && (
            <li className="flex items-center gap-2.5 py-2">
              <span className="sx-doc-ic" aria-hidden><NavGlyph name="doc" /></span>
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-neutral-800">Production Order</span>
              <Link href={`/production/orders/${productionOrderId}`} className={ACT}>Open</Link>
            </li>
          )}
          {files
            .filter((f) => f.kind === "attachment")
            .map((f) => (
              <li key={f.key} className="flex items-center gap-2.5 py-2">
                <span className="sx-doc-ic" aria-hidden><NavGlyph name="doc" /></span>
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
