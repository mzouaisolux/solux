/**
 * Document-number allocation tests.
 *
 * Locks in the behaviour saveDocument relies on to survive a colliding number
 * from next_client_document_number() (the RPC undercounts under RLS — see
 * lib/document-number.ts). The pure pieces (parse / format / jump hint /
 * collision detection) are covered here; the async insert probe is exercised
 * end-to-end via a real login.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseDocumentNumber,
  formatDocumentNumber,
  highestVisibleSeq,
  isDocumentNumberCollision,
} from "../lib/document-number.ts";

test("parseDocumentNumber splits prefix and sequence", () => {
  assert.deepEqual(parseDocumentNumber("SLX-ABC-26-001"), {
    prefix: "SLX-ABC-26-",
    seq: 1,
  });
  assert.deepEqual(parseDocumentNumber("SLX-ABC-26-012"), {
    prefix: "SLX-ABC-26-",
    seq: 12,
  });
  // 4-digit overflow past 999 still parses.
  assert.deepEqual(parseDocumentNumber("SLX-ABC-26-1000"), {
    prefix: "SLX-ABC-26-",
    seq: 1000,
  });
});

test("parseDocumentNumber returns null for revisions and junk", () => {
  // Revision suffix — must NOT be probed/renumbered.
  assert.equal(parseDocumentNumber("SLX-ABC-26-001-V2"), null);
  assert.equal(parseDocumentNumber(""), null);
  assert.equal(parseDocumentNumber(null), null);
  assert.equal(parseDocumentNumber(undefined), null);
  assert.equal(parseDocumentNumber("no-trailing-digits"), null);
});

test("formatDocumentNumber zero-pads to at least 3 digits", () => {
  assert.equal(formatDocumentNumber("SLX-ABC-26-", 4), "SLX-ABC-26-004");
  assert.equal(formatDocumentNumber("SLX-ABC-26-", 42), "SLX-ABC-26-042");
  assert.equal(formatDocumentNumber("SLX-ABC-26-", 7), "SLX-ABC-26-007");
  assert.equal(formatDocumentNumber("SLX-ABC-26-", 1000), "SLX-ABC-26-1000");
});

test("format(parse(x)) round-trips a canonical number", () => {
  const p = parseDocumentNumber("SLX-ZEA-26-003");
  assert.ok(p);
  assert.equal(formatDocumentNumber(p!.prefix, p!.seq), "SLX-ZEA-26-003");
});

test("highestVisibleSeq ignores other prefixes and revisions", () => {
  const prefix = "SLX-ABC-26-";
  assert.equal(
    highestVisibleSeq(prefix, [
      "SLX-ABC-26-001",
      "SLX-ABC-26-003",
      "SLX-ABC-26-002-V2", // revision → ignored
      "SLX-XYZ-26-009", // different prefix → ignored
      null,
      undefined,
    ]),
    3
  );
  assert.equal(highestVisibleSeq(prefix, []), null);
  // All hidden by RLS → caller must fall back to probing from the RPC guess.
  assert.equal(highestVisibleSeq(prefix, ["SLX-XYZ-26-009"]), null);
});

test("isDocumentNumberCollision matches the global number unique violation", () => {
  assert.equal(
    isDocumentNumberCollision({
      code: "23505",
      message:
        'duplicate key value violates unique constraint "documents_number_key"',
    }),
    true
  );
  // Message-only (no code) still recognised.
  assert.equal(
    isDocumentNumberCollision({
      message:
        'duplicate key value violates unique constraint "documents_number_key"',
    }),
    true
  );
});

test("isDocumentNumberCollision ignores unrelated errors", () => {
  assert.equal(
    isDocumentNumberCollision({
      code: "23503",
      message: 'insert or update on table "documents" violates foreign key',
    }),
    false
  );
  // A different unique violation must NOT be treated as a number collision.
  assert.equal(
    isDocumentNumberCollision({
      code: "23505",
      message:
        'duplicate key value violates unique constraint "clients_client_code_unique_idx"',
    }),
    false
  );
  assert.equal(isDocumentNumberCollision(null), false);
  assert.equal(isDocumentNumberCollision(undefined), false);
  assert.equal(isDocumentNumberCollision({}), false);
});
