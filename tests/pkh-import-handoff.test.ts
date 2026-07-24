/**
 * PKH baseline import — n8n handoff fan-out contract (pure).
 *
 * Locks the outbound half of the background-import path: requestBulkImport emits
 * `import.requested`, which MUST map to the logical `import.requested` webhook so
 * the existing dispatcher fans it out to n8n. Also guards that the inbound-only
 * `import.file_reviewed` event does NOT fan out (it's a feed record, not a hook).
 *
 * Pure imports only (integrations.ts has no DB / no @/ alias) so it runs under
 * the node --experimental-strip-types test runner. The commitImportPlan
 * idempotency and the /api/hooks/import-callback auth (401/503) checks require a
 * DB + the @/ alias, so they live in the e2e harness — see
 * features/product-knowledge-hub/docs/Import_Baseline_n8n_Handoff_Plan.md §5.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  webhookEventForEmit,
  WEBHOOK_EVENTS,
  WEBHOOK_EVENT_LABELS,
} from "../features/Intergration/lib/integrations.ts";

test("import.requested is a subscribable webhook event with a label", () => {
  assert.ok(
    (WEBHOOK_EVENTS as readonly string[]).includes("import.requested"),
    "import.requested must be in WEBHOOK_EVENTS so endpoints can subscribe"
  );
  assert.equal(
    WEBHOOK_EVENT_LABELS["import.requested"],
    "Baseline import requested (bulk PDF)"
  );
});

test("import.requested emit maps to the import.requested webhook (fans out to n8n)", () => {
  assert.equal(webhookEventForEmit("import.requested"), "import.requested");
});

test("import.file_reviewed is feed-only — it must NOT fan out to a webhook", () => {
  assert.equal(webhookEventForEmit("import.file_reviewed"), null);
  assert.ok(
    !(WEBHOOK_EVENTS as readonly string[]).includes("import.file_reviewed"),
    "import.file_reviewed is an inbound feed record, not a subscribable hook"
  );
});

test("adding import.requested did not disturb the existing spec fan-out", () => {
  assert.equal(webhookEventForEmit("spec.published"), "spec.published");
  assert.equal(webhookEventForEmit("spec_sheet.sent"), "spec_sheet.sent");
  assert.equal(webhookEventForEmit("nope.unknown"), null);
});
