import Link from "next/link";

/**
 * Access Denied panel — shown when a user opens a page their (effective)
 * role isn't allowed to see.
 *
 * Reuses the exact amber "Permission required" treatment from the app
 * error boundary (`app/(app)/error.tsx`), so a missing-capability page
 * gate and a missing-capability server-action throw look identical to
 * the user. Render it INLINE from a server page when
 * `hasUiCapability(...)` is false — that keeps View-As faithful (a
 * super-admin previewing as Sales sees the same denial a real Sales user
 * would), instead of a silent `redirect("/dashboard")` that leaves the
 * user wondering where the page went.
 *
 * Example:
 *   const allowed = await hasUiCapability("factory_mapping.access");
 *   if (!allowed) return <AccessDenied capability="factory_mapping.access" />;
 */
export default function AccessDenied({
  capability,
  title = "You don't have permission to view this page.",
  message,
}: {
  /** The capability key the page requires — quoted so the user can ask the right question. */
  capability?: string;
  /** Optional heading override. */
  title?: string;
  /** Optional explanatory line override. */
  message?: string;
}) {
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
              Access denied
            </div>
            <h1 className="text-base font-semibold text-amber-900 mt-1">
              {title}
            </h1>
            <p className="text-sm text-amber-900 mt-2 leading-relaxed">
              {message ??
                "This page is restricted. Access is controlled by the permissions matrix."}
            </p>
            {capability && (
              <>
                <p className="text-sm text-amber-900 mt-2 leading-relaxed">
                  It requires the capability:
                </p>
                <code className="block mt-2 rounded-md bg-amber-100 border border-amber-200 px-2.5 py-1.5 text-xs font-mono text-amber-900">
                  {capability}
                </code>
              </>
            )}
            <p className="text-sm text-amber-800 mt-3 leading-relaxed">
              Ask a super-admin to enable this for your role in{" "}
              <b>/permissions/actions</b>. If you believe this is a mistake,
              share the capability name above when reporting.
            </p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 mt-5">
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
