"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  subscribeToasts,
  pushToast,
  dismissToast,
  type ToastItem,
  type ToastType,
} from "./toast-store";

/**
 * Global toaster — mounted once in the app layout. Shows imperative toasts
 * (toast.success/error/info) AND a one-shot `?flash=` query param so actions
 * that REDIRECT (create project, generate quotation) can confirm on the
 * destination page. Strips the flash param after showing it.
 */
const TONE: Record<ToastType, { box: string; icon: string }> = {
  success: { box: "border-emerald-200 bg-emerald-50 text-emerald-900", icon: "✓" },
  error: { box: "border-rose-200 bg-rose-50 text-rose-900", icon: "✕" },
  info: { box: "border-neutral-200 bg-white text-neutral-800", icon: "•" },
};

export function Toaster() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [mounted, setMounted] = useState(false);
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    setMounted(true);
    return subscribeToasts(setToasts);
  }, []);

  // One-shot flash param → toast, then strip it from the URL.
  useEffect(() => {
    const flash = sp.get("flash");
    if (!flash) return;
    pushToast(flash, (sp.get("flash_type") as ToastType) || "success");
    const params = new URLSearchParams(sp.toString());
    params.delete("flash");
    params.delete("flash_type");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [sp, pathname, router]);

  if (!mounted || toasts.length === 0) return null;

  return createPortal(
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col gap-2">
      {toasts.map((t) => {
        const tone = TONE[t.type];
        return (
          <div
            key={t.id}
            role="status"
            onClick={() => dismissToast(t.id)}
            className={`pointer-events-auto flex max-w-sm cursor-pointer items-start gap-2 rounded-lg border px-3.5 py-2.5 text-sm shadow-lg shadow-neutral-200/60 ${tone.box}`}
          >
            <span className="mt-0.5 font-semibold">{tone.icon}</span>
            <span className="font-medium">{t.message}</span>
          </div>
        );
      })}
    </div>,
    document.body
  );
}
