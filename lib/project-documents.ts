/**
 * PROJECT DOCUMENT REPOSITORY — pure model (owner spec 2026-07-07).
 *
 * The affair's Documents section is the SINGLE SOURCE OF TRUTH: every file
 * related to a project — generated or uploaded, from any module — appears
 * there, organised into folders. This file is the pure vocabulary shared by
 * the server aggregator (lib/project-documents-server.ts) and the UI
 * (AffairDocumentsCard): folder taxonomy, categorisation rules, search.
 *
 * ADDING A NEW DOCUMENT SOURCE (future modules): implement one collector in
 * lib/project-documents-server.ts that maps your rows to `ProjectDocument`
 * and pick a folder here. Nothing else — the UI renders whatever the
 * aggregator returns.
 */

/* ===========================================================================
   Folders
   =========================================================================== */

export type ProjectFolder =
  | "commercial"
  | "study_lab"
  | "technical"
  | "production"
  | "logistics"
  | "customer";

// `icon` = NavIcons glyph name (Solux DNA line pictos); `emoji` kept for
// plain-text surfaces (email bodies, PDF, logs) that can't render SVG.
export const PROJECT_FOLDERS: { key: ProjectFolder; label: string; emoji: string; icon: string }[] = [
  { key: "commercial", label: "Commercial", emoji: "💼", icon: "briefcase" },
  { key: "study_lab", label: "Study Lab", emoji: "🔬", icon: "flask" },
  { key: "technical", label: "Technical", emoji: "📐", icon: "dividers" },
  { key: "production", label: "Production", emoji: "🏭", icon: "factory" },
  { key: "logistics", label: "Logistics", emoji: "🚢", icon: "ship" },
  { key: "customer", label: "Customer Files", emoji: "📎", icon: "paperclip" },
];

export function folderLabel(f: ProjectFolder): string {
  return PROJECT_FOLDERS.find((x) => x.key === f)?.label ?? f;
}

/* ===========================================================================
   The normalized document
   =========================================================================== */

export type ProjectDocumentSource =
  | "quotation" // documents table (quotation / proforma / commercial invoice)
  | "attachment" // attachments table (manual uploads on the affair)
  | "order_document" // order_documents table (PO uploads incl. shipping docs)
  | "lighting" // product_lighting_setups (energy study / dialux)
  | "request_file" // project_request_files (SR technical dossier, m090/m157)
  | "record"; // in-app record page (task list, production order…)

/** Lifecycle status of a repository file (m150) — quotations keep their own. */
export type ProjectDocStatus = "draft" | "approved" | "final";

export const DOC_STATUS_LABEL: Record<ProjectDocStatus, string> = {
  draft: "Draft",
  approved: "Approved",
  final: "Final",
};

/** Tailwind tone for the status pill — status is the only color. */
export const DOC_STATUS_TONE: Record<ProjectDocStatus, string> = {
  draft: "border-neutral-200 bg-neutral-50 text-neutral-500",
  approved: "border-sky-200 bg-sky-50 text-sky-700",
  final: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

export type ProjectDocument = {
  /** stable render key, e.g. "att:<id>" */
  key: string;
  name: string;
  folder: ProjectFolder;
  /** Human kind shown next to the name (e.g. "Quotation", "Bill of lading"). */
  kindLabel: string;
  source: ProjectDocumentSource;
  /** Open target (page or signed URL). */
  href: string;
  /** Direct download target when different from href (else null). */
  downloadHref: string | null;
  /** ISO date the doc appeared (upload / generation / doc date). */
  date: string | null;
  sizeLabel: string | null;
  /** Version number when the source is versioned (order docs, quotations). */
  version: number | null;
  /** Commercial status for quotations / invoices (draft/sent/won…). */
  status: string | null;
  /** Uploads only — enables Replace / Delete in the UI. */
  attachmentId: string | null;
  documentId: string | null;
  attachmentType: string | null;
  /** Display name of the uploader / creator (resolved server-side). */
  author: string | null;
  /** Lifecycle status (m150) — null when the source has none / pre-m150. */
  docStatus: ProjectDocStatus | null;
  /** Row id used by setProjectDocumentStatus (attachment / order_document). */
  sourceId: string | null;
  /** False only for superseded versions of a versioned document. */
  isCurrent: boolean;
  /** Share reference (createDocumentShareLink) — null when not shareable. */
  share: { source: string; id: string; extra?: string } | null;
};

/* ===========================================================================
   Categorisation rules
   =========================================================================== */

/** attachments.attachment_type → folder (extension can still override). */
const ATTACHMENT_FOLDER: Record<string, ProjectFolder> = {
  tender: "customer",
  technical_spec: "technical",
  mechanical_drawing: "technical",
  dimension_drawing: "technical",
  inspection: "production",
  approved_doc: "customer",
  packaging_artwork: "production",
  logo: "customer",
  rendering: "technical",
  photo: "customer",
  dialux: "study_lab",
  special_instructions: "production",
  other: "customer",
};

/** File extensions that are unambiguously technical drawings / CAD. */
const TECHNICAL_EXTENSIONS = new Set([
  "dwg",
  "dxf",
  "step",
  "stp",
  "iges",
  "igs",
  "cad",
]);

export function fileExtension(name: string): string {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i + 1).toLowerCase();
}

/** Folder for a manual upload — the type picker decides, CAD extensions win. */
export function folderForAttachment(
  attachmentType: string | null | undefined,
  fileName: string
): ProjectFolder {
  if (TECHNICAL_EXTENSIONS.has(fileExtension(fileName))) return "technical";
  return ATTACHMENT_FOLDER[attachmentType ?? "other"] ?? "customer";
}

/** project_request_files.category → folder (SR technical dossier). */
export function folderForRequestFile(
  category: string | null | undefined
): ProjectFolder {
  switch (category) {
    case "spec":
    case "drawing":
    case "pole_drawing":
      return "technical";
    case "packing":
      return "logistics";
    case "costing":
      return "commercial"; // the cost basis of the offer (view_cost-gated upstream)
    case "tender":
    case "requirement":
    case "image":
    default:
      return "customer";
  }
}

/** order_documents.category → folder. */
export function folderForOrderDoc(category: string | null | undefined): ProjectFolder {
  switch (category) {
    case "shipping":
      return "logistics";
    case "financial":
      return "commercial";
    case "production":
    default:
      return "production";
  }
}

/* ===========================================================================
   Version collapsing (order_documents groups)
   =========================================================================== */

export type OrderDocLite = {
  id: string;
  group_id: string;
  version: number;
  name: string;
  category: string | null;
  file_size: number | null;
  created_at: string | null;
  archived_at: string | null;
};

/**
 * Keep only the CURRENT (highest) version of each logical document group,
 * dropping archived groups. Older versions stay in the table (Lot 2 will
 * surface a per-group history).
 */
export function latestOrderDocs(rows: OrderDocLite[]): OrderDocLite[] {
  const byGroup = new Map<string, OrderDocLite>();
  for (const r of rows) {
    if (r.archived_at) continue;
    const cur = byGroup.get(r.group_id);
    if (!cur || (r.version ?? 1) > (cur.version ?? 1)) byGroup.set(r.group_id, r);
  }
  return Array.from(byGroup.values());
}

/* ===========================================================================
   Attachment version collapsing (m151 — group_id chains Replace history)
   =========================================================================== */

export type AttachmentVersionMeta = {
  id: string;
  group_id: string | null;
  version: number | null;
};

/**
 * Which attachment rows are the CURRENT version of their group. Pre-m151
 * rows (no group_id) are their own group. Returns the current ids plus the
 * version number to display for every id.
 */
export function currentAttachmentVersions(rows: AttachmentVersionMeta[]): {
  currentIds: Set<string>;
  versionById: Map<string, number>;
  groupSizeById: Map<string, number>;
} {
  const byGroup = new Map<string, AttachmentVersionMeta[]>();
  for (const r of rows) {
    const key = r.group_id ?? r.id;
    const list = byGroup.get(key) ?? [];
    list.push(r);
    byGroup.set(key, list);
  }
  const currentIds = new Set<string>();
  const versionById = new Map<string, number>();
  const groupSizeById = new Map<string, number>();
  for (const [, list] of byGroup) {
    let top: AttachmentVersionMeta = list[0];
    for (const r of list) {
      if ((r.version ?? 1) > (top.version ?? 1)) top = r;
    }
    currentIds.add(top.id);
    for (const r of list) {
      versionById.set(r.id, r.version ?? 1);
      groupSizeById.set(r.id, list.length);
    }
  }
  return { currentIds, versionById, groupSizeById };
}

/* ===========================================================================
   Search / filter (client-side — the repository is one project's files)
   =========================================================================== */

export function filterProjectDocuments(
  docs: ProjectDocument[],
  q: string,
  folder: ProjectFolder | null,
  opts?: { author?: string | null; latestOnly?: boolean }
): ProjectDocument[] {
  const needle = q.trim().toLowerCase();
  const latestOnly = opts?.latestOnly ?? true;
  return docs.filter((d) => {
    if (latestOnly && !d.isCurrent) return false;
    if (folder && d.folder !== folder) return false;
    if (opts?.author && d.author !== opts.author) return false;
    if (!needle) return true;
    return `${d.name} ${d.kindLabel} ${folderLabel(d.folder)} ${d.author ?? ""}`
      .toLowerCase()
      .includes(needle);
  });
}

/** Distinct author names present in the repository (for the filter). */
export function repositoryAuthors(docs: ProjectDocument[]): string[] {
  return Array.from(
    new Set(docs.map((d) => d.author).filter(Boolean) as string[])
  ).sort();
}

/** Group into folders, catalog order, empty folders skipped. */
export function groupByFolder(
  docs: ProjectDocument[]
): { folder: (typeof PROJECT_FOLDERS)[number]; docs: ProjectDocument[] }[] {
  return PROJECT_FOLDERS.map((folder) => ({
    folder,
    docs: docs
      .filter((d) => d.folder === folder.key)
      .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")),
  })).filter((g) => g.docs.length > 0);
}

export function fileSizeLabel(bytes: number | null | undefined): string | null {
  if (!bytes || bytes <= 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
