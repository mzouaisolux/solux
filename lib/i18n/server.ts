// =====================================================================
// Server-side locale resolution (cookie → Accept-Language → en).
// Server Components: `const t = getT(); t("key")`.
// =====================================================================

import { cookies, headers } from "next/headers";
import {
  asLocale,
  makeT,
  DEFAULT_LOCALE,
  LOCALES,
  type Locale,
  type TFunction,
} from "@/lib/i18n";

export const LOCALE_COOKIE = "solux_locale";

/** Active locale for this request: cookie wins, else browser, else en. */
export function getLocale(): Locale {
  const cookieVal = cookies().get(LOCALE_COOKIE)?.value;
  if (cookieVal) return asLocale(cookieVal);
  const al = headers().get("accept-language") ?? "";
  const first = al.split(",")[0]?.split("-")[0]?.trim().toLowerCase();
  return (LOCALES as readonly string[]).includes(first ?? "")
    ? (first as Locale)
    : DEFAULT_LOCALE;
}

/** Bound translator for the request's locale (Server Components). */
export function getT(): TFunction {
  return makeT(getLocale());
}
