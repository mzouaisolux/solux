import { createClient } from "@/lib/supabase/server";

/**
 * Is a notification actually delivered for this event? True iff the event's
 * MASTER routing row exists and is enabled (event_routing, consumer =
 * 'notification', role = '*') — the same opt-in gate the bell resolves at
 * read time (lib/notifications.loadNotificationConfig).
 *
 * Server actions use this for HONEST user feedback (owner 2026-07-11):
 * a toast may only claim "Operations notified" when the registry really
 * routes the event to someone. Fail-closed: any error ⇒ false ⇒ the softer
 * "it's in the queue" wording.
 */
export async function isEventNotificationEnabled(
  eventKey: string
): Promise<boolean> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("event_routing")
      .select("enabled")
      .eq("consumer", "notification")
      .eq("event_key", eventKey)
      .eq("role", "*")
      .maybeSingle();
    if (error || !data) return false;
    return (data as any).enabled !== false;
  } catch {
    return false;
  }
}
