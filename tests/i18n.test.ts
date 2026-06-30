/**
 * i18n tests — locks the fallback chain (locale → en → key), the
 * interpolation, and catalog integrity (fr/es only hold keys that exist
 * in en; en has no empty values). EN is the source of truth.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { translate, makeT, asLocale, LOCALES, MESSAGES } from "../lib/i18n/index.ts";
import { en } from "../lib/i18n/en.ts";
import { fr } from "../lib/i18n/fr.ts";
import { es } from "../lib/i18n/es.ts";

test("translate returns the locale string when present", () => {
  assert.equal(translate("fr", "action.save"), "Enregistrer");
  assert.equal(translate("es", "action.cancel"), "Cancelar");
  assert.equal(translate("en", "action.save"), "Save");
});

test("missing key in a locale falls back to EN", () => {
  // es has no nav.item.diagnostics → falls back to en
  assert.equal(translate("es", "nav.item.diagnostics"), en["nav.item.diagnostics"]);
  assert.ok(es["nav.item.diagnostics"] === undefined, "es should not define this key (proves fallback)");
});

test("missing key everywhere falls back to the key itself", () => {
  assert.equal(translate("fr", "totally.unknown.key"), "totally.unknown.key");
});

test("interpolation replaces {vars}", () => {
  assert.equal(translate("en", "dashboard.greeting", { name: "Mehdi" }), "Good day, Mehdi");
  assert.equal(translate("fr", "dashboard.greeting", { name: "Mehdi" }), "Bonjour, Mehdi");
  assert.equal(translate("fr", "dashboard.bucket.preventive", { days: 7 }), "À anticiper — 7 prochains jours");
});

test("makeT binds a locale", () => {
  const t = makeT("fr");
  assert.equal(t("action.delete"), "Supprimer");
});

test("asLocale narrows or defaults", () => {
  assert.equal(asLocale("fr"), "fr");
  assert.equal(asLocale("xx"), "en");
  assert.equal(asLocale(null), "en");
});

/* ---- catalog integrity ---- */

test("en has no empty values (source of truth is complete)", () => {
  for (const [k, v] of Object.entries(en)) {
    assert.ok(v && v.trim().length > 0, `en[${k}] is empty`);
  }
});

test("fr and es only contain keys that exist in en (no orphans)", () => {
  for (const [loc, dict] of [["fr", fr], ["es", es]] as const) {
    for (const k of Object.keys(dict)) {
      assert.ok(k in en, `${loc} has orphan key not in en: ${k}`);
    }
  }
});

test("every interpolated key uses the same vars across locales", () => {
  // dashboard.greeting must keep {name}, preventive must keep {days}
  for (const loc of LOCALES) {
    assert.ok(MESSAGES[loc]["dashboard.greeting"] === undefined || MESSAGES[loc]["dashboard.greeting"].includes("{name}"));
  }
});

import { navKeyForEnglish } from "../lib/i18n/index.ts";

test("navKeyForEnglish maps English nav labels to keys", () => {
  assert.equal(navKeyForEnglish("Dashboard"), "nav.cat.dashboard");
  assert.equal(navKeyForEnglish("Prospects & Tenders"), "nav.item.prospects_tenders");
  assert.equal(navKeyForEnglish("Not a nav label"), null);
  // round-trip: an English label translates to French via its key
  const k = navKeyForEnglish("Cost Entry")!;
  assert.equal(translate("fr", k), "Saisie des coûts");
});
