"use server";

import { requireCapabilityOrAdmin } from "@/lib/permissions";
import {
  loadForecastAuditForDocument,
  type ForecastAuditEvent,
} from "@/lib/forecast-audit";
import { resolveUserLabelStrings } from "@/lib/user-display";

export type ForecastHistoryPayload = {
  events: ForecastAuditEvent[];
  /** user id → display label, for changed_by / owner rendering. */
  userLabels: Record<string, string>;
};

/**
 * Fetch the audit trail for one forecast line (quotation) — the data
 * behind the admin-only History drawer on /forecast.
 *
 * Double gate: requireCapability app-side + RLS on the table itself,
 * so neither a UI bug nor a direct call can leak the trail to sales.
 */
export async function loadForecastHistory(
  documentId: string
): Promise<ForecastHistoryPayload> {
  if (!documentId) throw new Error("Missing document id");
  await requireCapabilityOrAdmin("forecast.view_audit");

  const events = await loadForecastAuditForDocument(documentId);

  const userIds = Array.from(
    new Set(
      events
        .flatMap((e) => [e.changedBy, e.ownerId])
        .filter((v): v is string => !!v)
    )
  );
  const labels = await resolveUserLabelStrings(userIds);

  return { events, userLabels: Object.fromEntries(labels) };
}
