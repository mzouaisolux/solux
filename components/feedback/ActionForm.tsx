"use client";

import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { toast } from "./toast-store";

/** Redirect/notFound throw a digest we must rethrow so navigation proceeds. */
function isNavError(e: any): boolean {
  const d = e?.digest;
  return typeof d === "string" && (d.startsWith("NEXT_REDIRECT") || d.startsWith("NEXT_NOT_FOUND"));
}

/**
 * A <form> that gives consistent feedback: on success shows a ✓ toast and
 * refreshes server data; on failure shows the error as a toast. For actions
 * that redirect, the destination's `?flash=` shows the confirmation instead
 * (the redirect is rethrown so navigation proceeds). Drop-in replacement for
 * `<form action={serverAction}>` — put a <SubmitButton/> inside.
 */
export function ActionForm({
  action,
  success,
  error,
  refresh = true,
  className,
  children,
}: {
  action: (formData: FormData) => Promise<void>;
  success: string;
  error?: string;
  refresh?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  return (
    <form
      className={className}
      action={async (fd) => {
        try {
          await action(fd);
          toast.success(success);
          if (refresh) router.refresh();
        } catch (e: any) {
          if (isNavError(e)) throw e; // let redirect / notFound proceed
          toast.error(error ?? e?.message ?? "Something went wrong.");
        }
      }}
    >
      {children}
    </form>
  );
}

/** Submit button that reflects the enclosing form's pending state. */
export function SubmitButton({
  children,
  pendingLabel,
  className = "btn-primary",
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button className={`${className} disabled:opacity-60`} disabled={pending}>
      {pending ? pendingLabel ?? "Working…" : children}
    </button>
  );
}
