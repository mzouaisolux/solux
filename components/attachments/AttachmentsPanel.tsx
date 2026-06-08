import { createClient } from "@/lib/supabase/server";
import { resolveUserLabelStrings } from "@/lib/user-display";
import { formatFileSize, type AttachmentRow } from "@/lib/attachments";
import { AttachmentUploader } from "./AttachmentUploader";
import { AttachmentDeleteButton } from "./AttachmentDeleteButton";
import { AttachmentRowEditor } from "./AttachmentRowEditor";

/**
 * AttachmentsPanel — project files for an affair.
 *
 * Self-loading server component. Resolves the affair root from the
 * passed document id, lists the affair's attachments (RLS-scoped),
 * mints short-lived signed download URLs, and renders them + the
 * uploader. Shared across quotation versions + the task list because
 * everything keys on the affair root.
 *
 * Visibility chips (Sales/Ops/Factory/Client) are shown for clarity;
 * filtering by audience is a future enhancement (structure is ready).
 */
export async function AttachmentsPanel({
  documentId,
  title = "Attachments",
  subtitle = "Tender docs, drawings, dimensions, artwork — shared across all versions of this affair.",
}: {
  documentId: string;
  title?: string;
  subtitle?: string;
}) {
  const supabase = createClient();

  // Affair root (root_document_id ?? id), tolerating pre-m059.
  let affairId = documentId;
  try {
    const { data } = await supabase
      .from("documents")
      .select("id, root_document_id")
      .eq("id", documentId)
      .maybeSingle();
    affairId = (data?.root_document_id as string | null) ?? documentId;
  } catch {
    affairId = documentId;
  }

  // Attachments for the affair (RLS scopes visibility).
  let rows: AttachmentRow[] = [];
  const res = await supabase
    .from("attachments")
    .select("*")
    .eq("affair_id", affairId)
    .order("created_at", { ascending: false });
  if (!res.error) {
    rows = (res.data ?? []) as AttachmentRow[];
  }
  // If m060 isn't applied, res.error fires — render the uploader anyway
  // so the UI is present; the upload will surface the "apply m060" hint.

  // Files are opened via an on-demand download route (see
  // /api/attachments/[id]/download) that mints a FRESH signed URL per
  // click and returns a clean error page on failure. We intentionally do
  // NOT generate signed URLs here at render time: doing so for every row
  // made this server component throw (and blank the whole page) whenever
  // one file couldn't be signed — e.g. a Task List Manager opening a file
  // a sales uploaded. Resilient by construction now.
  //
  // Uploader labels — best-effort; never let a label lookup blank the page.
  let uploaderLabels = new Map<string, string>();
  try {
    uploaderLabels = await resolveUserLabelStrings(
      rows.map((r) => r.uploaded_by ?? "")
    );
  } catch {
    uploaderLabels = new Map();
  }

  return (
    <section className="panel p-4">
      <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
        <div>
          <div className="eyebrow">{title}</div>
          <p className="text-xs text-neutral-500 mt-0.5 max-w-2xl">{subtitle}</p>
        </div>
        <span className="text-[11px] text-neutral-400 tabular-nums">
          {rows.length} file{rows.length === 1 ? "" : "s"}
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-neutral-400 mb-3">
          No attachments yet. Add the project&apos;s drawings, dimensions,
          tender docs or artwork below — they stay linked to this affair
          through every quotation version + the task list.
        </p>
      ) : (
        <ul className="mb-3 divide-y divide-neutral-100 rounded-md border border-neutral-200">
          {rows.map((r) => {
            // Stable in-app URL — the route generates a fresh signed URL
            // (or shows a clean "file unavailable" page) on click. Opening
            // it can never blank the current page.
            const url = `/api/attachments/${r.id}/download`;
            // Image detection (mime first, extension as fallback) so we can
            // render an inline preview — a thumbnail makes the file's actual
            // content obvious at a glance (e.g. an empty screenshot is
            // instantly recognizable, no clicking + no confusion).
            const isImage =
              (r.mime_type ?? "").startsWith("image/") ||
              /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(r.file_name);
            const ext =
              (r.file_name.split(".").pop() || "FILE").slice(0, 4).toUpperCase();
            const audiences = [
              r.visible_sales && "Sales",
              r.visible_ops && "Ops",
              r.visible_factory && "Factory",
              r.visible_client && "Client",
            ].filter(Boolean) as string[];
            return (
              <li
                key={r.id}
                className="flex items-start gap-3 px-3 py-2.5 hover:bg-neutral-50/60"
              >
                {/* Preview — image thumbnail, or a type pastille. Opens the
                    full file on click (same route, new tab). */}
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 block h-12 w-12 rounded border border-neutral-200 bg-neutral-50 overflow-hidden"
                  title={`Open ${r.file_name}`}
                >
                  {isImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={url}
                      alt={r.file_name}
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-[10px] font-semibold text-neutral-400">
                      {ext}
                    </span>
                  )}
                </a>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs font-medium text-neutral-900 hover:underline truncate"
                    >
                      {r.file_name}
                    </a>
                    {r.file_size != null && (
                      <span className="text-[10px] text-neutral-400 shrink-0">
                        {formatFileSize(r.file_size)}
                      </span>
                    )}
                  </div>
                  {/* Per-file type + comment — editable inline. */}
                  <div className="mt-1.5">
                    <AttachmentRowEditor
                      id={r.id}
                      documentId={documentId}
                      initialType={r.attachment_type}
                      initialNote={r.note}
                    />
                  </div>
                  <div className="flex items-center gap-2 flex-wrap mt-1 text-[10px] text-neutral-400">
                    <span>
                      {new Date(r.created_at).toLocaleDateString("en-GB", {
                        day: "2-digit",
                        month: "short",
                        year: "2-digit",
                      })}
                    </span>
                    {r.uploaded_by && (
                      <>
                        <span>·</span>
                        <span>{uploaderLabels.get(r.uploaded_by)}</span>
                      </>
                    )}
                    {audiences.length > 0 && (
                      <>
                        <span>·</span>
                        <span>{audiences.join(" / ")}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0 pt-0.5">
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] text-neutral-600 hover:text-neutral-900"
                  >
                    Open
                  </a>
                  <AttachmentDeleteButton
                    id={r.id}
                    documentId={documentId}
                    fileName={r.file_name}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <AttachmentUploader documentId={documentId} affairId={affairId} />
    </section>
  );
}
