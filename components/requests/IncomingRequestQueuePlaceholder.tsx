import Link from "next/link";
import { canAccessOrAdmin, type Capability } from "@/lib/permissions";
import AccessDenied from "@/components/AccessDenied";

/**
 * PLACEHOLDER shell for an incoming-request queue that doesn't have its
 * dedicated module yet — the processing side of the request layer (the
 * "Requests" mega menu for Operations / Task List Managers, built from
 * INCOMING_REQUEST_QUEUES in lib/request-types.ts).
 *
 * Deliberately the SAME shell as the reference queue,
 * /operations/transport-requests (m161): capability guard + sx header +
 * queue area (empty state). NO new workflow, NO new design — when a
 * request type gets its real module, the page swaps this placeholder for
 * its queue component; the menu entry doesn't change.
 */
export default async function IncomingRequestQueuePlaceholder({
  title,
  description,
  capabilities,
  todayHint,
}: {
  title: string;
  /** One-liner under the H1 — what lands in this queue, who submits it. */
  description: string;
  /** SAME list as the menu entry (lib/request-types.ts) — the page guard. */
  capabilities: Capability[];
  /** Where these requests are processed TODAY, while the module isn't built. */
  todayHint?: { label: string; href: string };
}) {
  const allowed = await canAccessOrAdmin(capabilities);
  if (!allowed) return <AccessDenied capability={capabilities[0]} />;

  return (
    <div className="solux-pro sx-page">
      <div className="sx-wrap">
        <div className="sx-head">
          <div>
            <div className="sx-eyebrow">Incoming requests</div>
            <h1 className="sx-h1">{title}</h1>
            <p className="sx-sub">{description}</p>
          </div>
        </div>
        <p className="mt-4 text-sm text-neutral-400">
          Nothing here yet — this queue opens when its request module ships.
          {todayHint ? (
            <>
              {" "}
              Today, these requests are handled in{" "}
              <Link href={todayHint.href} className="underline">
                {todayHint.label}
              </Link>
              .
            </>
          ) : null}
        </p>
      </div>
    </div>
  );
}
