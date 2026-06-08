/**
 * Tiny client-side toast store (module-level pub/sub) — no provider needed, so
 * `toast.success(...)` is callable from any client component. Used by the
 * global <Toaster/> (mounted once in the app layout) and the <ActionForm/>
 * feedback wrapper.
 */

export type ToastType = "success" | "error" | "info";
export type ToastItem = { id: number; message: string; type: ToastType };

let toasts: ToastItem[] = [];
let listeners: Array<(t: ToastItem[]) => void> = [];
let nextId = 1;

function emit() {
  for (const l of listeners) l(toasts);
}

export function subscribeToasts(listener: (t: ToastItem[]) => void): () => void {
  listeners.push(listener);
  listener(toasts);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

export function pushToast(message: string, type: ToastType = "success", ttlMs = 4000): void {
  const id = nextId++;
  toasts = [...toasts, { id, message, type }];
  emit();
  if (typeof window !== "undefined") {
    window.setTimeout(() => {
      toasts = toasts.filter((t) => t.id !== id);
      emit();
    }, ttlMs);
  }
}

export function dismissToast(id: number): void {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export const toast = {
  success: (m: string) => pushToast(m, "success"),
  error: (m: string) => pushToast(m, "error", 6000),
  info: (m: string) => pushToast(m, "info"),
};
