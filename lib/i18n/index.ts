// =====================================================================
// i18n — minimal, dependency-free (owner decision 2026-06-15: "maison
// léger", no route restructuring, progressive, en = default).
//
// `translate(locale, key, vars)` is PURE (node-testable): it looks up the
// active locale, falls back to EN, then to the key itself, and
// interpolates {var} placeholders. EN is the source of truth — every key
// MUST exist in en.ts; fr/es may be partial and fall back to en.
//
// Used by the server helper (lib/i18n/server.ts → getT) and the client
// provider (components/i18n/I18nProvider → useT). Untranslated UI keeps
// its hardcoded English until migrated to t() — nothing breaks.
// =====================================================================

import { en } from "./en.ts";
import { fr } from "./fr.ts";
import { es } from "./es.ts";

export const LOCALES = ["en", "fr", "es"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_LABEL: Record<Locale, string> = {
  en: "English",
  fr: "Français",
  es: "Español",
};

export type Dict = Record<string, string>;

export const MESSAGES: Record<Locale, Dict> = { en, fr, es };

/** Narrow any string to a valid Locale, else the default. */
export function asLocale(v: string | null | undefined): Locale {
  return (LOCALES as readonly string[]).includes(v ?? "") ? (v as Locale) : DEFAULT_LOCALE;
}

/**
 * Translate `key` for `locale`. Fallback chain: locale → en → key.
 * `vars` interpolates `{name}` placeholders. Pure — no I/O.
 */
export function translate(
  locale: Locale,
  key: string,
  vars?: Record<string, string | number>
): string {
  const dict = MESSAGES[locale] ?? MESSAGES[DEFAULT_LOCALE];
  let s = dict[key] ?? MESSAGES[DEFAULT_LOCALE][key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.split(`{${k}}`).join(String(v));
    }
  }
  return s;
}

/** A bound translator for one locale. */
export type TFunction = (key: string, vars?: Record<string, string | number>) => string;

export function makeT(locale: Locale): TFunction {
  return (key, vars) => translate(locale, key, vars);
}

/* ------------------------------------------------------------------ */
/* Nav reverse-lookup — translate the existing English nav config       */
/* without editing it: English label → key → t(). Pure.                 */
/* ------------------------------------------------------------------ */

const NAV_REVERSE: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const [k, v] of Object.entries(en)) {
    if (k.startsWith("nav.") && !(v in m)) m[v] = k;
  }
  return m;
})();

/** Key for an English nav string, or null if it isn't a known nav label. */
export function navKeyForEnglish(text: string): string | null {
  return NAV_REVERSE[text] ?? null;
}
