// =====================================================================
// Attachment anchor resolution (server-only).
//
// `attachments.affair_id` changed conventions over time:
//   m060 era   — version-chain root document id (root_document_id ?? id)
//   post-5307c — the REAL affairs.id (affair_id = single source of truth)
// A file must never disappear because the anchor convention evolved, so
// every reader matches the FULL candidate set and the writer targets the
// real affair id once migration m156 (backfill + RLS) is applied.
// =====================================================================

import type { createClient } from "@/lib/supabase/server";
import { migrationApplied } from "@/lib/migrations";

type Supa = ReturnType<typeof createClient>;

export type AttachmentAnchorContext = {
  /** documents.affair_id of the context document (null pre-affair linking). */
  affairId: string | null;
  /** m060-era anchor: root_document_id ?? document id. */
  legacyAnchor: string;
  /** EVERY value attachments.affair_id may carry for this affair. */
  anchors: string[];
};

/**
 * Resolve every anchor an attachment of this document's AFFAIR may carry:
 * the real affair id, the version-chain root, and every sibling document id
 * + root of the same affair (files uploaded from any version/module of the
 * affair must all surface). `contextId` may also be a raw affairs.id (the
 * upload panel of a document-less project passes the affair id directly).
 */
export async function resolveAttachmentAnchors(
  supabase: Supa,
  contextId: string
): Promise<AttachmentAnchorContext> {
  const anchors = new Set<string>([contextId]);
  let affairId: string | null = null;
  let legacyAnchor = contextId;
  try {
    const { data: doc } = await supabase
      .from("documents")
      .select("id, root_document_id, affair_id")
      .eq("id", contextId)
      .maybeSingle();
    if (doc) {
      const root = (doc.root_document_id as string | null) ?? doc.id;
      legacyAnchor = root;
      affairId = (doc.affair_id as string | null) ?? null;
      anchors.add(root);
      if (affairId) anchors.add(affairId);
      // Siblings: every document of the same affair + the whole version chain.
      const or = affairId
        ? `affair_id.eq.${affairId},root_document_id.eq.${root},id.eq.${root}`
        : `root_document_id.eq.${root},id.eq.${root}`;
      const { data: sibs } = await supabase
        .from("documents")
        .select("id, root_document_id, affair_id")
        .or(or);
      for (const s of sibs ?? []) {
        anchors.add(s.id);
        if (s.root_document_id) anchors.add(s.root_document_id);
        if (s.affair_id) anchors.add(s.affair_id);
      }
    } else {
      // Not a document — a document-less project passes the affairs.id itself.
      affairId = contextId;
    }
  } catch {
    // Defensive: any lookup failure degrades to the raw context id.
  }
  return { affairId, legacyAnchor, anchors: Array.from(anchors) };
}

/**
 * The anchor NEW attachment rows should be written with. The real affair id
 * is the target (owner rule: affair_id = single source of truth) but the
 * m060 RLS read policy only follows document anchors — so we only switch
 * once m156 (backfill + RLS arm on d.affair_id) is applied, otherwise a
 * sales rep's fresh upload would be invisible to them. Probe the migration
 * ledger (m156 self-inserts per the m113 rule); any error → legacy anchor.
 */
export async function resolveAttachmentWriteAnchor(
  supabase: Supa,
  contextId: string
): Promise<string> {
  const ctx = await resolveAttachmentAnchors(supabase, contextId);
  if (!ctx.affairId) return ctx.legacyAnchor;
  if (ctx.affairId === contextId) return ctx.affairId; // document-less project
  if (await migrationApplied(supabase, "156_attachments_affair_anchor.sql"))
    return ctx.affairId;
  return ctx.legacyAnchor;
}
