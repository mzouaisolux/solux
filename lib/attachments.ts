/**
 * Attachments — pure types + the document-type catalog.
 *
 * Client + server safe (no DB access). The server helpers live in the
 * actions file; this module just defines the shared vocabulary used by
 * the uploader + the panel.
 */

export type AttachmentType =
  | "tender"
  | "technical_spec"
  | "mechanical_drawing"
  | "inspection"
  | "dimension_drawing"
  | "approved_doc"
  | "packaging_artwork"
  | "logo"
  | "rendering"
  | "photo"
  | "dialux"
  | "special_instructions"
  | "other";

/** The Storage bucket reused for attachments (same one PDFs live in). */
export const ATTACHMENTS_BUCKET = "documents";

/** Catalog — order = display order in the type picker. */
export const ATTACHMENT_TYPES: Array<{
  value: AttachmentType;
  label: string;
}> = [
  { value: "tender", label: "Tender document" },
  { value: "technical_spec", label: "Technical specification" },
  { value: "mechanical_drawing", label: "Mechanical drawing" },
  { value: "dimension_drawing", label: "Dimension drawing" },
  { value: "inspection", label: "Inspection requirement" },
  { value: "approved_doc", label: "Approved client document" },
  { value: "packaging_artwork", label: "Packaging artwork" },
  { value: "logo", label: "Logo file" },
  { value: "rendering", label: "Product rendering" },
  { value: "photo", label: "Photo" },
  { value: "dialux", label: "DIALux report" },
  { value: "special_instructions", label: "Special instructions" },
  { value: "other", label: "Other" },
];

export function attachmentTypeLabel(t: string | null | undefined): string {
  if (!t) return "Other";
  return ATTACHMENT_TYPES.find((x) => x.value === t)?.label ?? t;
}

export type AttachmentRow = {
  id: string;
  affair_id: string;
  storage_path: string;
  file_name: string;
  file_size: number | null;
  mime_type: string | null;
  attachment_type: AttachmentType;
  note: string | null;
  visible_sales: boolean;
  visible_ops: boolean;
  visible_factory: boolean;
  visible_client: boolean;
  uploaded_by: string | null;
  created_at: string;
};

/** Human file size, e.g. "1.4 MB". */
export function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 50 MB upload ceiling — keeps things lightweight + within Storage
 *  limits. Enforced client-side before upload + echoed in the action. */
export const ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024;
