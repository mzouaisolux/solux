/**
 * Affair grouping — affair_id is the single source of truth (owner ruling
 * 2026-07-07). A won quotation and the proforma Launch Production created are
 * ONE affair, never two rows. root_document_id only groups LEGACY documents
 * that predate the affairs table.
 *
 * Run with: npm test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  groupIntoAffairs,
  buildAffairFiles,
  affairAnchorId,
  type PrototypeDoc,
  type AffairRecord,
  type AttachmentLite,
} from "../lib/affairs-prototype.ts";

const AFFAIR = "aaaaaaaa-0000-0000-0000-000000000001";
const CLIENT = "cccccccc-0000-0000-0000-000000000001";

function doc(over: Partial<PrototypeDoc>): PrototypeDoc {
  return {
    id: "d-x",
    number: null,
    client_id: CLIENT,
    root_document_id: null,
    version: 1,
    affair_name: null,
    status: "draft",
    type: "quotation",
    date: "2026-07-01",
    total_price: 0,
    currency: "USD",
    forecast_probability: null,
    archived_at: null,
    affair_id: null,
    pdf_url: null,
    ...over,
  };
}

const affairRec: AffairRecord = {
  id: AFFAIR,
  client_id: CLIENT,
  name: "OIM - Malanville",
  status: "lead",
  owner_id: null,
  archived_at: null,
};

const emptyMaps = () => ({
  clients: new Map(),
  owners: new Map(),
  tl: new Map<string, string>(),
  po: new Map<string, string>(),
  events: new Map(),
});

test("anchor rule: affair_id wins over root_document_id / id", () => {
  assert.equal(
    affairAnchorId(doc({ id: "d1", root_document_id: "r1", affair_id: AFFAIR })),
    AFFAIR,
  );
  assert.equal(affairAnchorId(doc({ id: "d1", root_document_id: "r1" })), "r1");
  assert.equal(affairAnchorId(doc({ id: "d1" })), "d1");
});

test("won quotation + launched proforma (different chains, same affair) → ONE row", () => {
  // The exact production bug: SLX-AFR-26-001 (won quotation, chain A) and
  // SLX-AFR-26-002 (proforma from Launch Production, chain B) both carry the
  // same affair_id — they must group as ONE affair, not two.
  const quotation = doc({
    id: "q1",
    number: "SLX-AFR-26-001",
    status: "won",
    type: "quotation",
    date: "2026-07-01",
    total_price: 128510,
    affair_id: AFFAIR,
    affair_name: "OIM - Malanville",
  });
  const proforma = doc({
    id: "p1",
    number: "SLX-AFR-26-002",
    status: "sent",
    type: "proforma",
    date: "2026-07-06",
    total_price: 128510,
    affair_id: AFFAIR,
  });
  const m = emptyMaps();
  const grouped = groupIntoAffairs(
    [quotation, proforma],
    m.clients,
    m.owners,
    m.tl,
    m.po,
    m.events,
    new Map([[AFFAIR, affairRec]]),
  );
  const affairs = grouped.flatMap((c) => c.affairs);
  assert.equal(affairs.length, 1, "one affair, not two");
  const a = affairs[0];
  assert.equal(a.anchorId, AFFAIR);
  assert.equal(a.displayName, "OIM - Malanville");
  assert.equal(a.documents.length, 2);
  assert.equal(a.quotationCount, 1);
  assert.equal(a.proformaCount, 1);
  assert.equal(a.effectiveStatus, "won", "won sticks even with a later sent proforma");
  assert.equal(a.latest?.id, "p1", "latest = most recent doc (date tiebreak on equal versions)");
  assert.equal(a.isRealAffair, true);
  assert.equal(a.affairId, AFFAIR);
});

test("legacy documents without affair_id still group by version chain root", () => {
  const v1 = doc({ id: "r1", version: 1 });
  const v2 = doc({ id: "d2", root_document_id: "r1", version: 2 });
  const other = doc({ id: "z9", date: "2026-06-01" });
  const m = emptyMaps();
  const grouped = groupIntoAffairs(
    [v1, v2, other],
    m.clients,
    m.owners,
    m.tl,
    m.po,
    m.events,
    new Map(),
  );
  const affairs = grouped.flatMap((c) => c.affairs);
  assert.equal(affairs.length, 2);
  const chain = affairs.find((a) => a.anchorId === "r1");
  assert.equal(chain?.documents.length, 2);
  assert.equal(chain?.latestVersion, 2);
});

test("document-less affair appears once, anchored on the RAW affair id (no prefix)", () => {
  const m = emptyMaps();
  const grouped = groupIntoAffairs(
    [],
    m.clients,
    m.owners,
    m.tl,
    m.po,
    m.events,
    new Map([[AFFAIR, affairRec]]),
  );
  const affairs = grouped.flatMap((c) => c.affairs);
  assert.equal(affairs.length, 1);
  assert.equal(affairs[0].anchorId, AFFAIR, "raw id — same key space as attachments");
  assert.equal(affairs[0].isRealAffair, true);
});

test("attachments stored by affair_id surface on the group (no chain split)", () => {
  const quotation = doc({ id: "q1", status: "won", affair_id: AFFAIR });
  const proforma = doc({ id: "p1", type: "proforma", date: "2026-07-06", affair_id: AFFAIR });
  const m = emptyMaps();
  const [group] = groupIntoAffairs(
    [quotation, proforma],
    m.clients,
    m.owners,
    m.tl,
    m.po,
    m.events,
    new Map([[AFFAIR, affairRec]]),
  ).flatMap((c) => c.affairs);
  const attachments: AttachmentLite[] = [
    { id: "att1", affair_id: AFFAIR, file_name: "site-photo.jpg", file_size: 1024, attachment_type: "photo", created_at: "2026-07-02" },
    { id: "att2", affair_id: "other-affair", file_name: "unrelated.pdf", file_size: 10, attachment_type: "other", created_at: "2026-07-02" },
  ];
  const files = buildAffairFiles(group, attachments);
  const attFiles = files.filter((f) => f.kind === "attachment");
  assert.equal(attFiles.length, 1, "only this affair's attachments");
  assert.equal(attFiles[0].name, "site-photo.jpg");
  // and both document versions are listed too
  assert.equal(files.filter((f) => f.kind === "quotation").length, 2);
});
