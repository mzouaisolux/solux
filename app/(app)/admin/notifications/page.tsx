// Superseded by the unified Event Registry (Step 1, m136). The bell now
// reads event_routing, not notification_rules, so this notification-only
// matrix is folded into the per-event console at /admin/events. Keep the
// route as a redirect so existing nav links / bookmarks still land somewhere.
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function NotificationsRedirect() {
  redirect("/admin/events");
}
