/**
 * Project document repository (SSoT) — pure-logic tests: folder taxonomy,
 * categorisation rules (attachment type + CAD extension override + order-doc
 * category), current-version collapsing, and search/grouping.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PROJECT_FOLDERS,
  PROJECT_FOLDER_KEYS,
  isProjectFolder,
  folderForAttachment,
  folderForOrderDoc,
  fileExtension,
  latestOrderDocs,
  filterProjectDocuments,
  repositoryAuthors,
  currentAttachmentVersions,
  groupByFolder,
  fileSizeLabel,
  type ProjectDocument,
} from "../lib/project-documents.ts";

test("folder taxonomy is the 8 merged categories from the spec, in order", () => {
  assert.deepEqual(PROJECT_FOLDERS.map((f) => f.key), [
    "commercial",
    "customer",
    "technical",
    "energy_studies",
    "certifications",
    "photos",
    "contracts",
    "other",
  ]);
  assert.deepEqual(PROJECT_FOLDER_KEYS, PROJECT_FOLDERS.map((f) => f.key));
  // Merged labels span the combined scope.
  const label = (k: string) => PROJECT_FOLDERS.find((f) => f.key === k)!.label;
  assert.equal(label("technical"), "Technical Files & Drawings");
  assert.equal(label("energy_studies"), "Energy & Lighting Studies");
  assert.equal(label("photos"), "Photos & Shipping Documents");
});

test("isProjectFolder validates the vocabulary", () => {
  assert.equal(isProjectFolder("technical"), true);
  assert.equal(isProjectFolder("contracts"), true);
  assert.equal(isProjectFolder("drawings"), false); // merged into technical
  assert.equal(isProjectFolder("lighting_studies"), false); // merged into energy_studies
  assert.equal(isProjectFolder("shipping"), false); // merged into photos
  assert.equal(isProjectFolder("study_lab"), false); // retired key
  assert.equal(isProjectFolder("nonsense"), false);
  assert.equal(isProjectFolder(null), false);
  assert.equal(isProjectFolder(undefined), false);
});

test("folderForAttachment maps the type picker to the merged categories", () => {
  assert.equal(folderForAttachment("dialux", "report.pdf"), "energy_studies");
  assert.equal(folderForAttachment("technical_spec", "spec.pdf"), "technical");
  assert.equal(folderForAttachment("mechanical_drawing", "d.pdf"), "technical");
  assert.equal(folderForAttachment("dimension_drawing", "d.pdf"), "technical");
  assert.equal(folderForAttachment("photo", "site.jpg"), "photos");
  assert.equal(folderForAttachment("rendering", "r.jpg"), "photos");
  assert.equal(folderForAttachment("tender", "rfq.pdf"), "customer");
  assert.equal(folderForAttachment("inspection", "qc.pdf"), "certifications");
  assert.equal(folderForAttachment("special_instructions", "n.pdf"), "other");
  assert.equal(folderForAttachment("other", "misc.pdf"), "other");
  assert.equal(folderForAttachment(null, "misc.pdf"), "other");
  assert.equal(folderForAttachment("unknown_future_type", "x.pdf"), "other");
});

test("a user-assigned folder override ALWAYS wins over the derived category", () => {
  // Drag & drop (m164) — the explicit choice beats type + extension.
  assert.equal(folderForAttachment("photo", "site.jpg", "contracts"), "contracts");
  assert.equal(folderForAttachment("other", "layout.dwg", "certifications"), "certifications");
  assert.equal(folderForAttachment("dialux", "r.pdf", "commercial"), "commercial");
  // A now-retired / invalid override is ignored → falls back to derivation.
  assert.equal(folderForAttachment("photo", "site.jpg", "shipping"), "photos");
  assert.equal(folderForAttachment("photo", "site.jpg", null), "photos");
  assert.equal(folderForAttachment("photo", "site.jpg", ""), "photos");
});

test("CAD extensions land in Technical Files & Drawings by default", () => {
  assert.equal(folderForAttachment("other", "layout.DWG"), "technical");
  assert.equal(folderForAttachment("photo", "road.dxf"), "technical");
  assert.equal(folderForAttachment(null, "pole.step"), "technical");
  // …but an explicit override still wins over the CAD-extension rule.
  assert.equal(folderForAttachment("other", "layout.DWG", "photos"), "photos");
  assert.equal(fileExtension("a.b.DWG"), "dwg");
  assert.equal(fileExtension("noext"), "");
});

test("folderForOrderDoc maps PO doc categories to merged folders", () => {
  assert.equal(folderForOrderDoc("shipping"), "photos"); // Photos & Shipping
  assert.equal(folderForOrderDoc("financial"), "commercial");
  assert.equal(folderForOrderDoc("production"), "technical");
  assert.equal(folderForOrderDoc("other"), "technical");
  assert.equal(folderForOrderDoc(null), "technical");
});

test("latestOrderDocs keeps only the current version per group, drops archived", () => {
  const rows = [
    { id: "1", group_id: "g1", version: 1, name: "BL.pdf", category: "shipping", file_size: 1, created_at: "2026-01-01", archived_at: null },
    { id: "2", group_id: "g1", version: 2, name: "BL-v2.pdf", category: "shipping", file_size: 1, created_at: "2026-02-01", archived_at: null },
    { id: "3", group_id: "g2", version: 1, name: "QC.pdf", category: "production", file_size: 1, created_at: "2026-01-15", archived_at: "2026-03-01" },
    { id: "4", group_id: "g3", version: 1, name: "Insurance.pdf", category: "shipping", file_size: 1, created_at: "2026-01-20", archived_at: null },
  ];
  const latest = latestOrderDocs(rows);
  assert.deepEqual(latest.map((r) => r.id).sort(), ["2", "4"]);
  assert.equal(latest.find((r) => r.group_id === "g1")?.version, 2);
});

const mk = (over: Partial<ProjectDocument>): ProjectDocument => ({
  key: over.key ?? Math.random().toString(36),
  name: "f.pdf",
  folder: "customer",
  kindLabel: "Other",
  source: "attachment",
  href: "#",
  downloadHref: null,
  date: null,
  sizeLabel: null,
  version: null,
  status: null,
  attachmentId: null,
  documentId: null,
  attachmentType: null,
  author: null,
  docStatus: null,
  sourceId: null,
  isCurrent: true,
  share: null,
  ...over,
});

test("filterProjectDocuments searches name, kind and folder label", () => {
  const docs = [
    mk({ key: "a", name: "Quotation-V2.pdf", kindLabel: "Quotation", folder: "commercial" }),
    mk({ key: "b", name: "BL-MSC-1234.pdf", kindLabel: "Bill of lading", folder: "photos" }),
    mk({ key: "c", name: "site-photo.jpg", kindLabel: "Photo", folder: "photos" }),
  ];
  assert.deepEqual(filterProjectDocuments(docs, "lading", null).map((d) => d.key), ["b"]);
  assert.deepEqual(filterProjectDocuments(docs, "", "photos").map((d) => d.key).sort(), ["b", "c"]);
  assert.deepEqual(filterProjectDocuments(docs, "photo", "commercial").map((d) => d.key), []);
  assert.equal(filterProjectDocuments(docs, "", null).length, 3);
});

test("groupByFolder returns catalog order, newest first inside, skips empties by default", () => {
  const docs = [
    mk({ key: "old", folder: "photos", date: "2026-01-01" }),
    mk({ key: "new", folder: "photos", date: "2026-06-01" }),
    mk({ key: "q", folder: "commercial", date: "2026-03-01" }),
  ];
  const groups = groupByFolder(docs);
  assert.deepEqual(groups.map((g) => g.folder.key), ["commercial", "photos"]);
  assert.deepEqual(groups.find((g) => g.folder.key === "photos")!.docs.map((d) => d.key), ["new", "old"]);
});

test("groupByFolder(includeEmpty) returns ALL 8 categories as drop targets", () => {
  const docs = [mk({ key: "q", folder: "commercial" })];
  const all = groupByFolder(docs, true);
  assert.equal(all.length, 8);
  assert.deepEqual(all.map((g) => g.folder.key), PROJECT_FOLDER_KEYS);
  // Empty categories are present with empty doc lists (visible drop zones).
  assert.deepEqual(all.find((g) => g.folder.key === "contracts")!.docs, []);
  assert.equal(all.find((g) => g.folder.key === "commercial")!.docs.length, 1);
});

test("filter: latestOnly (default) hides superseded versions; off shows them", () => {
  const docs = [
    mk({ key: "v2", name: "BL.pdf", isCurrent: true, version: 2 }),
    mk({ key: "v1", name: "BL.pdf", isCurrent: false, version: 1 }),
  ];
  assert.deepEqual(filterProjectDocuments(docs, "", null).map((d) => d.key), ["v2"]);
  assert.deepEqual(
    filterProjectDocuments(docs, "", null, { latestOnly: false }).map((d) => d.key),
    ["v2", "v1"]
  );
});

test("filter: by author + author searchable + repositoryAuthors distinct sorted", () => {
  const docs = [
    mk({ key: "a", author: "Sam Sales" }),
    mk({ key: "b", author: "Olivia Ops" }),
    mk({ key: "c", author: "Sam Sales" }),
    mk({ key: "d", author: null }),
  ];
  assert.deepEqual(
    filterProjectDocuments(docs, "", null, { author: "Sam Sales" }).map((d) => d.key),
    ["a", "c"]
  );
  assert.deepEqual(filterProjectDocuments(docs, "olivia", null).map((d) => d.key), ["b"]);
  assert.deepEqual(repositoryAuthors(docs), ["Olivia Ops", "Sam Sales"]);
});

test("currentAttachmentVersions: max version per group is current; legacy rows are own group", () => {
  const { currentIds, versionById, groupSizeById } = currentAttachmentVersions([
    { id: "a1", group_id: "g1", version: 1 },
    { id: "a2", group_id: "g1", version: 2 },
    { id: "b1", group_id: null, version: null }, // pre-m151 legacy
    { id: "c1", group_id: "c1", version: 1 },
  ]);
  assert.deepEqual(Array.from(currentIds).sort(), ["a2", "b1", "c1"]);
  assert.equal(versionById.get("a1"), 1);
  assert.equal(versionById.get("a2"), 2);
  assert.equal(versionById.get("b1"), 1);
  assert.equal(groupSizeById.get("a1"), 2);
  assert.equal(groupSizeById.get("c1"), 1);
});

test("fileSizeLabel formats bytes", () => {
  assert.equal(fileSizeLabel(500), "500 B");
  assert.equal(fileSizeLabel(150 * 1024), "150 KB");
  assert.equal(fileSizeLabel(2.5 * 1024 * 1024), "2.5 MB");
  assert.equal(fileSizeLabel(0), null);
  assert.equal(fileSizeLabel(null), null);
});

// m157 — SR technical dossier files land in the right repository folder.
import { folderForRequestFile } from "../lib/project-documents.ts";

test("folderForRequestFile: SR categories → folders", () => {
  assert.equal(folderForRequestFile("costing"), "commercial");
  assert.equal(folderForRequestFile("pole_drawing"), "technical");
  assert.equal(folderForRequestFile("spec"), "technical");
  assert.equal(folderForRequestFile("drawing"), "technical");
  assert.equal(folderForRequestFile("packing"), "photos");
  assert.equal(folderForRequestFile("tender"), "customer");
  assert.equal(folderForRequestFile("requirement"), "customer");
  assert.equal(folderForRequestFile("image"), "customer");
  assert.equal(folderForRequestFile("other"), "customer");
  assert.equal(folderForRequestFile(null), "customer");
});
