/**
 * Tests for the commercial-price lock predicate (m139).
 * (lib/types.ts → isLineLocked)
 *
 * Run with:  npm test
 *
 * Pure (no DB / no server imports). These lock the core business rule of the
 * catalogue/commercial decoupling: the catalogue defines what we MANUFACTURE,
 * the Service Request defines what we SELL. A quotation line whose price does
 * NOT come from the catalogue must never be re-priced from the catalogue when a
 * model is attached. `isLineLocked` is the single predicate that both the
 * builder's `pickModel` (attach a manufacturing reference only) and `commit`
 * (never re-resolve the catalogue price) branch on.
 *
 *   catalogue                 -> NOT locked (catalogue may drive the price)
 *   manual                    -> locked (sales' own selling price)
 *   approved_service_request  -> locked (Sales-Director-approved SR price)
 *   imported                  -> locked (historical import origin)
 *
 * Plus the pre-migration fallback: before m139 backfills `pricing_source`, a
 * legacy row is judged by its mechanical mode (manual => locked), so an
 * already-generated Service-Request quotation (pricing_mode "manual") is
 * protected even before the column exists.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { isLineLocked } from "../lib/types.ts";

// --- explicit pricing_source (post-m139) -----------------------------------

test("catalogue source is NOT locked — the catalogue may drive its price", () => {
  assert.equal(isLineLocked({ pricing_source: "catalogue" }), false);
  // pricing_mode is irrelevant when a source is present.
  assert.equal(
    isLineLocked({ pricing_source: "catalogue", pricing_mode: "manual" }),
    false
  );
});

test("manual source is locked — sales' own price is protected", () => {
  assert.equal(isLineLocked({ pricing_source: "manual" }), true);
});

test("approved_service_request source is locked — the approved price wins", () => {
  assert.equal(
    isLineLocked({ pricing_source: "approved_service_request" }),
    true
  );
  // Even if some legacy row still carries mode "auto", the source wins.
  assert.equal(
    isLineLocked({
      pricing_source: "approved_service_request",
      pricing_mode: "auto",
    }),
    true
  );
});

test("imported source is locked — historical price is protected", () => {
  assert.equal(isLineLocked({ pricing_source: "imported" }), true);
});

// --- pre-migration fallback (no pricing_source column yet) ------------------

test("fallback: no source + manual mode => locked (protects generated SR quotes pre-m139)", () => {
  assert.equal(isLineLocked({ pricing_mode: "manual" }), true);
  assert.equal(
    isLineLocked({ pricing_source: null, pricing_mode: "manual" }),
    true
  );
});

test("fallback: no source + auto mode => NOT locked (a plain catalogue line)", () => {
  assert.equal(isLineLocked({ pricing_mode: "auto" }), false);
  assert.equal(
    isLineLocked({ pricing_source: null, pricing_mode: "auto" }),
    false
  );
});

test("fallback: nothing set => NOT locked (a fresh blank line defaults to catalogue)", () => {
  assert.equal(isLineLocked({}), false);
});
