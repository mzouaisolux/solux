"use client";

import { createContext, useContext, useMemo } from "react";
import { makeT, type Locale, type TFunction } from "@/lib/i18n";

const I18nCtx = createContext<TFunction>((k) => k);

/** Wraps the app so client components can translate via useT(). The
 *  locale is resolved ONCE server-side and passed in (no hydration drift). */
export function I18nProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  const t = useMemo(() => makeT(locale), [locale]);
  return <I18nCtx.Provider value={t}>{children}</I18nCtx.Provider>;
}

export function useT(): TFunction {
  return useContext(I18nCtx);
}
