"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Errors Next.js uses for control flow — not real errors. We must NOT
 * render an error UI for these; the framework needs to handle them.
 *
 * NEXT_REDIRECT  : thrown by `redirect()` from server actions
 * NEXT_NOT_FOUND : thrown by `notFound()`
 *
 * If we render UI instead of letting Next process these, the user gets
 * a fake "error" panel when really the action succeeded and just
 * wanted to navigate. This was the cause of the "delete task list
 * shows error and seems not to work" bug — the delete DID happen but
 * the redirect was intercepted.
 */
function isControlFlowError(error: { digest?: string } | undefined): boolean {
  const digest = error?.digest ?? "";
  return digest.startsWith("NEXT_REDIRECT") || digest === "NEXT_NOT_FOUND";
}

/**
 * Error boundary for the `(app)` route tree.
 *
 * Catches every uncaught throw from server actions / server components
 * under `/dashboard`, `/operations`, `/clients`, etc. — and renders a
 * clean recovery UI instead of the bright-red Next.js dev overlay.
 *
 * Special-cases permission errors
 * --------------------------------
 * `lib/permissions.ts → requireCapability()` throws with a message that
 * always starts with the prefix `"Missing required capability:"`. When
 * we see that prefix we render an amber "you don't have permission"
 * panel that quotes the missing capability + tells the user what to
 * ask their super-admin. This is much friendlier than a generic 500.
 *
 * Every other error falls through to a generic recovery panel with a
 * "Try again" button (which calls Next's `reset()` to re-render the
 * server boundary) and a "Go to dashboard" link.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // If this is a Next.js control-flow "error" (redirect / notFound),
  // call reset() immediately so the framework processes it instead of
  // us showing an error UI. This unblocks server actions that end
  // with redirect("/somewhere"). Critical: don't render any UI for
  // these cases — return null below.
  useEffect(() => {
    if (isControlFlowError(error)) {
      reset();
      return;
    }
    // Real errors: surface to console for dev visibility.
    console.error("[AppError boundary]", error);
  }, [error, reset]);

  // For control-flow errors, render nothing while reset() lets Next
  // handle the redirect / 404 properly.
  if (isControlFlowError(error)) {
    return null;
  }

  const missingCapability = parseMissingCapability(error.message);

  if (missingCapability) {
    return (
      <div className="mx-auto max-w-2xl p-8">
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-5">
          <div className="flex items-start gap-3">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-6 w-6 mt-0.5 shrink-0 text-amber-600"
              aria-hidden
            >
              <path
                fillRule="evenodd"
                d="M18 10A8 8 0 1 1 2 10a8 8 0 0 1 16 0Zm-7-4a1 1 0 1 0-2 0v4a1 1 0 1 0 2 0V6Zm-1 8a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"
                clipRule="evenodd"
              />
            </svg>
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-widerx text-amber-800">
                Permission required
              </div>
              <h1 className="text-base font-semibold text-amber-900 mt-1">
                You don&apos;t have permission for this action.
              </h1>
              <p className="text-sm text-amber-900 mt-2 leading-relaxed">
                The action you tried to perform requires the capability:
              </p>
              <code className="block mt-2 rounded-md bg-amber-100 border border-amber-200 px-2.5 py-1.5 text-xs font-mono text-amber-900">
                {missingCapability}
              </code>
              <p className="text-sm text-amber-800 mt-3 leading-relaxed">
                Ask a super-admin to enable this capability for your role
                in <b>/permissions/actions</b>. If you believe this is a
                mistake, share the capability name above when reporting.
              </p>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 mt-5">
            <button
              type="button"
              onClick={() => reset()}
              className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-50 transition-colors"
            >
              Try again
            </button>
            <Link
              href="/dashboard"
              className="rounded-md bg-amber-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-800 transition-colors"
            >
              Back to dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Generic fallback — anything else that goes wrong.
  return (
    <div className="mx-auto max-w-2xl p-8">
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-5">
        <div className="flex items-start gap-3">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-6 w-6 mt-0.5 shrink-0 text-rose-600"
            aria-hidden
          >
            <path
              fillRule="evenodd"
              d="M18 10A8 8 0 1 1 2 10a8 8 0 0 1 16 0Zm-8-5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 10 5Zm0 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
              clipRule="evenodd"
            />
          </svg>
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-widerx text-rose-800">
              Something went wrong
            </div>
            <h1 className="text-base font-semibold text-rose-900 mt-1">
              We couldn&apos;t complete that action.
            </h1>
            <p className="text-sm text-rose-800 mt-2 leading-relaxed">
              The error has been logged to the dev console. You can retry
              the action — if it keeps failing, share the message below
              when reporting.
            </p>
            <code className="block mt-3 rounded-md bg-rose-100 border border-rose-200 px-2.5 py-1.5 text-xs font-mono text-rose-900 break-words">
              {error.message || "Unknown error"}
            </code>
            {error.digest && (
              <div className="text-[11px] text-rose-700 mt-2 font-mono">
                ref: {error.digest}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 mt-5">
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-md border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-900 hover:bg-rose-50 transition-colors"
          >
            Try again
          </button>
          <Link
            href="/dashboard"
            className="rounded-md bg-rose-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-800 transition-colors"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}

/**
 * Detect the canonical "Missing required capability: <key>." pattern
 * emitted by lib/permissions.ts → requireCapability(). Returns the
 * capability key when matched, null otherwise.
 */
function parseMissingCapability(message: string | undefined): string | null {
  if (!message) return null;
  const match = message.match(
    /Missing required capability:\s*([a-z_]+\.[a-z_]+)/i
  );
  return match ? match[1] : null;
}
