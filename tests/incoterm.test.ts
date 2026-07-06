/**
 * Tests for the Incoterm-aware Shipping fields (lib/incoterm.ts).
 *
 * Run with:  npm test   (pure — no DB / no server imports)
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  shippingFieldsForIncoterm,
  DEFAULT_INCOTERM,
  DEFAULT_PORT_OF_LOADING,
} from "../lib/incoterm.ts";

test("defaults are FOB + Shanghai", () => {
  assert.equal(DEFAULT_INCOTERM, "FOB");
  assert.equal(DEFAULT_PORT_OF_LOADING, "Shanghai");
});

test("EXW — no ports at all (factory pickup)", () => {
  const s = shippingFieldsForIncoterm("EXW");
  assert.equal(s.showPortOfLoading, false);
  assert.equal(s.showPortOfDestination, false);
  assert.match(s.note ?? "", /Ex Works/i);
});

test("FOB — Port of Loading only, required", () => {
  const s = shippingFieldsForIncoterm("FOB");
  assert.equal(s.showPortOfLoading, true);
  assert.equal(s.portOfLoadingRequired, true);
  assert.equal(s.showPortOfDestination, false);
  assert.equal(s.portOfLoadingLabel, "Port of Loading");
});

test("CFR / CIF — both ports shown, loading required", () => {
  for (const it of ["CFR", "CIF"]) {
    const s = shippingFieldsForIncoterm(it);
    assert.equal(s.showPortOfLoading, true, it);
    assert.equal(s.portOfLoadingRequired, true, it);
    assert.equal(s.showPortOfDestination, true, it);
  }
});

test("DDP / DDU — destination shown, loading optional", () => {
  for (const it of ["DDP", "DDU"]) {
    const s = shippingFieldsForIncoterm(it);
    assert.equal(s.showPortOfDestination, true, it);
    assert.equal(s.portOfLoadingRequired, false, it);
    assert.match(s.note ?? "", /destination/i, it);
  }
});

test("FCA — handover location label, no destination port", () => {
  const s = shippingFieldsForIncoterm("FCA");
  assert.equal(s.showPortOfLoading, true);
  assert.equal(s.portOfLoadingRequired, false);
  assert.match(s.portOfLoadingLabel, /handover|delivery/i);
  assert.equal(s.showPortOfDestination, false);
});

test("case-insensitive + null/unknown → safe default (both shown)", () => {
  assert.equal(shippingFieldsForIncoterm("fob").showPortOfLoading, true);
  const d = shippingFieldsForIncoterm(null);
  assert.equal(d.showPortOfLoading, true);
  assert.equal(d.showPortOfDestination, true);
});
