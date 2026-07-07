/**
 * Project document repository (SSoT) — pure-logic tests: folder taxonomy,
 * categorisation rules (attachment type + CAD extension override + order-doc
 * category), current-version collapsing, and search/grouping.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PROJECT_FOLDERS,
  folderForAttachment,
  folderForOrderDoc,
  fileExtension,
  latestOrderDocs,
  filterProjectDocuments,
  repositoryAuthors,
  groupByFolder,
  fileSizeLabel,
  type ProjectDocument,
} from "../lib/project-documents.ts";

test("folder taxonomy is the 6 folders from the spec, in order", () => {
  assert.deepEqual(
    PROJECT_FOLDERS.map((f) => f.key),
    ["commercial", "study_lab", "technical", "production", "logistics", "customer"]
  );
});

test("folderForAttachment maps the type picker to folders", () => {
  assert.equal(folderForAttachment("dialux", "report.pdf"), "study_lab");
  assert.equal(folderForAttachment("technical_spec", "spec.pdf"), "technical");
  assert.equal(folderForAttachment("mechanical_drawing", "d.pdf"), "technical");
  assert.equal(folderForAttachment("photo", "site.jpg"), "customer");
  assert.equal(folderForAttachment("tender", "rfq.pdf"), "customer");
  assert.equal(folderForAttachment("inspection", "qc.pdf"), "production");
  assert.equal(folderForAttachment("special_instructions", "n.pdf"), "production");
  assert.equal(folderForAttachment("other", "misc.pdf"), "customer");
  assert.equal(folderForAttachment(null, "misc.pdf"), "customer");
  assert.equal(folderForAttachment("unknown_future_type", "x.pdf"), "customer");
});

test("CAD extensions always land in Technical, whatever the picked type", () => {
  assert.equal(folderForAttachment("other", "layout.DWG"), "technical");
  assert.equal(folderForAttachment("photo", "road.dxf"), "technical");
  assert.equal(folderForAttachment(null, "pole.step"), "technical");
  assert.equal(fileExtension("a.b.DWG"), "dwg");
  assert.equal(fileExtension("noext"), "");
});

test("folderForOrderDoc maps PO doc categories", () => {
  assert.equal(folderForOrderDoc("shipping"), "logistics");
  assert.equal(folderForOrderDoc("financial"), "commercial");
  assert.equal(folderForOrderDoc("production"), "production");
  assert.equal(folderForOrderDoc("other"), "production");
  assert.equal(folderForOrderDoc(null), "production");
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
    mk({ key: "b", name: "BL-MSC-1234.pdf", kindLabel: "Bill of lading", folder: "logistics" }),
    mk({ key: "c", name: "site-photo.jpg", kindLabel: "Photo", folder: "customer" }),
  ];
  assert.deepEqual(filterProjectDocuments(docs, "lading", null).map((d) => d.key), ["b"]);
  assert.deepEqual(filterProjectDocuments(docs, "LOGISTICS", null).map((d) => d.key), ["b"]);
  assert.deepEqual(filterProjectDocuments(docs, "", "customer").map((d) => d.key), ["c"]);
  assert.deepEqual(filterProjectDocuments(docs, "photo", "commercial").map((d) => d.key), []);
  assert.equal(filterProjectDocuments(docs, "", null).length, 3);
});

test("groupByFolder returns catalog order, newest first inside, skips empties", () => {
  const docs = [
    mk({ key: "old", folder: "logistics", date: "2026-01-01" }),
    mk({ key: "new", folder: "logistics", date: "2026-06-01" }),
    mk({ key: "q", folder: "commercial", date: "2026-03-01" }),
  ];
  const groups = groupByFolder(docs);
  assert.deepEqual(groups.map((g) => g.folder.key), ["commercial", "logistics"]);
  assert.deepEqual(groups[1].docs.map((d) => d.key), ["new", "old"]);
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

test("fileSizeLabel formats bytes", () => {
  assert.equal(fileSizeLabel(500), "500 B");
  assert.equal(fileSizeLabel(150 * 1024), "150 KB");
  assert.equal(fileSizeLabel(2.5 * 1024 * 1024), "2.5 MB");
  assert.equal(fileSizeLabel(0), null);
  assert.equal(fileSizeLabel(null), null);
});
