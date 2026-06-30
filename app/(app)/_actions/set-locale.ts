"use server";

import { cookies } from "next/headers";
import { asLocale } from "@/lib/i18n";
import { LOCALE_COOKIE } from "@/lib/i18n/server";

/** Persist the user's language choice (1-year cookie). */
export async function setLocale(locale: string): Promise<void> {
  cookies().set(LOCALE_COOKIE, asLocale(locale), {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
}
