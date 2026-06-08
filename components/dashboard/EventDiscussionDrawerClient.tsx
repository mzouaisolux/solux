"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { EventDetailDrawer } from "./EventDetailDrawer";
import type { EventRow, EventComment } from "@/lib/events-shared";

/**
 * Thin client-side wrapper around EventDetailDrawer for the "open on
 * top of any entity page" flow.
 *
 * The drawer is always rendered open (controlled by URL: the parent
 * server panel only mounts this component when ?event=<id> is set
 * and resolves to a visible event). Closing the drawer removes the
 * `event` search param from the URL via router.replace — the parent
 * page re-renders without the panel.
 *
 * `router.replace` is used (not push) so the closed drawer doesn't
 * leave a back-history entry. `scroll: false` preserves the user's
 * current scroll position on the underlying entity page.
 */
export function EventDiscussionDrawerClient({
  event,
  initialComments,
  actorLabel,
  currentUserId,
  initialLastReadAt,
}: {
  event: EventRow;
  initialComments: EventComment[];
  actorLabel: Record<string, string>;
  currentUserId: string | null;
  initialLastReadAt: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function handleClose() {
    const next = new URLSearchParams(params.toString());
    next.delete("event");
    const q = next.toString();
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  }

  // Lift the actor label map into a Map<string,string> as the drawer
  // expects (the server passes a plain object for serialisation).
  const actorMap = new Map<string, string>(Object.entries(actorLabel));

  return (
    <EventDetailDrawer
      event={event}
      initialComments={initialComments}
      open={true}
      onClose={handleClose}
      actorLabel={actorMap}
      currentUserId={currentUserId}
      initialLastReadAt={initialLastReadAt}
    />
  );
}
