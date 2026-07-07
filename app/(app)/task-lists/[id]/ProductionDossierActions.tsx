"use client";

import { useState } from "react";
import { saveBlobAs } from "@/lib/saveBlob";
import { buildDossierEmail } from "@/lib/production-dossier";
import { generateProductionDossier } from "./dossier";
import { createClient as createBrowserSupabase } from "@/lib/supabase/client";
import { ATTACHMENTS_BUCKET } from "@/lib/attachments";
import { recordGeneratedDossier } from "./dossier-record-action";

/**
 * Post-validation actions — the natural END of the Task List Manager's
 * workflow, right on the task list page:
 *
 *   [ Generate Production PDF ]  [ Send by Email ]
 *
 * Both produce the SAME complete dossier (all sections + appendix of
 * uploaded documents). "Send by Email" additionally opens the user's mail
 * client pre-filled (there is no server-side mailer in this app — the
 * downloaded PDF is attached manually; the helper text says exactly that).
 */
export default function ProductionDossierActions({
  taskListId,
  compact = false,
}: {
  taskListId: string;
  /** compact = header placement (small buttons, no helper copy). */
  compact?: boolean;
}) {
  const [busy, setBusy] = useState<"pdf" | "email" | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileNotes, setFileNotes] = useState<string | null>(null);

  async function generate(mode: "pdf" | "email") {
    if (busy) return;
    setBusy(mode);
    setError(null);
    setDone(null);
    setFileNotes(null);
    try {
      const result = await generateProductionDossier(taskListId);
      await saveBlobAs(result.blob, result.fileName);

      // SSoT Lot 3 — generated documents are first-class: store the dossier
      // and register it in the project repository (order_documents, category
      // 'production', versioned per task list). Best-effort: a storage or
      // registration failure never blocks the download the user already got.
      try {
        const supabase = createBrowserSupabase();
        const path = `task-lists/${taskListId}/${Date.now()}-${result.fileName}`;
        const { error: upErr } = await supabase.storage
          .from(ATTACHMENTS_BUCKET)
          .upload(path, result.blob, { contentType: "application/pdf" });
        if (!upErr) {
          const fd = new FormData();
          fd.set("task_list_id", taskListId);
          fd.set("storage_path", path);
          fd.set("file_name", result.fileName);
          fd.set("file_size", String(result.blob.size));
          await recordGeneratedDossier(fd);
        }
      } catch {
        // best-effort — the dossier was still downloaded
      }

      const notes: string[] = [];
      if (result.skipped.length > 0) {
        notes.push(
          `Could not embed: ${result.skipped.join(", ")} — flagged in the document index.`
        );
      }
      if (result.external.length > 0) {
        notes.push(
          `Listed as “provided separately” (format not embeddable): ${result.external.join(", ")}.`
        );
      }
      setFileNotes(notes.length > 0 ? notes.join(" ") : null);

      if (mode === "email") {
        const { subject, body } = buildDossierEmail({
          number: result.data.number,
          affair: result.data.affair_name,
          client: result.data.client.company_name,
          fileName: result.fileName,
        });
        window.location.href = `mailto:?subject=${encodeURIComponent(
          subject
        )}&body=${encodeURIComponent(body)}`;
        setDone(
          "PDF downloaded — attach it to the email draft that just opened."
        );
      } else {
        setDone("✓ Production dossier downloaded");
      }
    } catch (e: any) {
      setError(e?.message ?? "Failed to generate the production dossier");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={compact ? "flex flex-col items-end gap-1" : "space-y-2"}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => generate("pdf")}
          disabled={busy !== null}
          className="inline-flex items-center justify-center gap-1.5 rounded-md bg-solux px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-solux-dark disabled:opacity-60"
          title="Generate the complete production dossier (all sections + uploaded documents merged as appendix)"
        >
          {busy === "pdf" ? "Generating dossier…" : "📄 Generate Production PDF"}
        </button>
        <button
          type="button"
          onClick={() => generate("email")}
          disabled={busy !== null}
          className="inline-flex items-center justify-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3.5 py-2 text-sm font-semibold text-neutral-800 shadow-sm transition-colors hover:bg-neutral-50 disabled:opacity-60"
          title="Generate the dossier, then open a pre-filled email — attach the downloaded PDF"
        >
          {busy === "email" ? "Preparing email…" : "✉️ Send by Email"}
        </button>
      </div>
      {done && <p className="text-xs text-emerald-700">{done}</p>}
      {fileNotes && <p className="text-xs text-amber-700">{fileNotes}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
      {!compact && !done && !error && (
        <p className="text-xs text-neutral-500 max-w-xl">
          One complete PDF: customer &amp; project info, product configuration,
          factory mapping &amp; instructions, battery, lighting program,
          stickers, transport, QA — plus every uploaded document merged as an
          appendix. Bilingual section titles (中文 / English).
        </p>
      )}
    </div>
  );
}
