"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { LOCALES, LOCALE_LABEL, type Locale } from "@/lib/i18n";
import { setLocale } from "@/app/(app)/_actions/set-locale";

/** EN / FR / ES picker — persists the choice (cookie) then refreshes so
 *  the server re-renders in the new locale. */
export function LanguageSwitcher({ current }: { current: Locale }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <select
      aria-label="Language"
      value={current}
      disabled={pending}
      onChange={(e) => {
        const next = e.target.value;
        start(async () => {
          await setLocale(next);
          router.refresh();
        });
      }}
      className="rounded border border-neutral-300 bg-white px-1.5 py-1 text-[12px] text-neutral-700"
    >
      {LOCALES.map((l) => (
        <option key={l} value={l}>
          {LOCALE_LABEL[l]}
        </option>
      ))}
    </select>
  );
}
