/**
 * Forecast audit trail — server-only loaders (m158).
 *
 * The trail itself is written by a DB trigger on `documents` (see
 * 158_forecast_standard_probabilities_and_audit.sql) — the app NEVER
 * inserts events directly, so every write path (forecast panel, Excel
 * import, bulk update, status flip, amount edit) is captured the same
 * way. This module only READS.
 *
 * Access: RLS already restricts SELECT to holders of the
 * `forecast.view_audit` capability, and every caller ALSO gates
 * app-side (requireCapability / hasUiCapability) — defense in depth.
 *
 * Soft-fails to an empty array when m158 isn't applied yet, so the
 * admin surfaces render a clean "no history yet" state instead of
 * crashing the route.
 */

import { createClient } from "@/lib/supabase/server";

export type ForecastAuditEvent = {
  id: string;
  createdAt: string;
  documentId: string | null;
  quotationNumber: string | null;
  affairId: string | null;
  projectName: string | null;
  clientId: string | null;
  clientName: string | null;
  country: string | null;
  /** Document currency at event time — formats the amount snapshots. */
  currency: string | null;
  ownerId: string | null;
  changedBy: string | null;
  changedByRole: string | null;
  changeSource: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  oldProbability: number | null;
  newProbability: number | null;
  oldExpectedCloseDate: string | null;
  newExpectedCloseDate: string | null;
  oldAmount: number | null;
  newAmount: number | null;
  oldWeighted: number | null;
  newWeighted: number | null;
  oldStatus: string | null;
  newStatus: string | null;
};

const EVENT_COLUMNS =
  "id, created_at, document_id, quotation_number, affair_id, project_name, " +
  "client_id, client_name, country, currency, owner_id, changed_by, changed_by_role, " +
  "change_source, field, old_value, new_value, old_probability, new_probability, " +
  "old_expected_close_date, new_expected_close_date, old_amount, new_amount, " +
  "old_weighted, new_weighted, old_status, new_status";

function mapEvent(r: any): ForecastAuditEvent {
  return {
    id: r.id,
    createdAt: r.created_at,
    documentId: r.document_id ?? null,
    quotationNumber: r.quotation_number ?? null,
    affairId: r.affair_id ?? null,
    projectName: r.project_name ?? null,
    clientId: r.client_id ?? null,
    clientName: r.client_name ?? null,
    country: r.country ?? null,
    currency: r.currency ?? null,
    ownerId: r.owner_id ?? null,
    changedBy: r.changed_by ?? null,
    changedByRole: r.changed_by_role ?? null,
    changeSource: r.change_source ?? "manual_edit",
    field: r.field,
    oldValue: r.old_value ?? null,
    newValue: r.new_value ?? null,
    oldProbability: r.old_probability ?? null,
    newProbability: r.new_probability ?? null,
    oldExpectedCloseDate: r.old_expected_close_date ?? null,
    newExpectedCloseDate: r.new_expected_close_date ?? null,
    oldAmount: r.old_amount != null ? Number(r.old_amount) : null,
    newAmount: r.new_amount != null ? Number(r.new_amount) : null,
    oldWeighted: r.old_weighted != null ? Number(r.old_weighted) : null,
    newWeighted: r.new_weighted != null ? Number(r.new_weighted) : null,
    oldStatus: r.old_status ?? null,
    newStatus: r.new_status ?? null,
  };
}

/** Full change history for ONE forecast line (quotation), newest first. */
export async function loadForecastAuditForDocument(
  documentId: string
): Promise<ForecastAuditEvent[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("forecast_audit_events")
    .select(EVENT_COLUMNS)
    .eq("document_id", documentId)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) {
    // m158 not applied — surface an empty trail, not a crash.
    console.warn("[loadForecastAuditForDocument]", error.message);
    return [];
  }
  return (data ?? []).map(mapEvent);
}

/**
 * Recent events across the whole book — the raw material for the
 * behavior analytics. Newest first, bounded (the analytics recompute
 * per page load; 5000 events ≈ years of forecast edits at current
 * volume — revisit with a date-window filter if it ever grows past
 * that).
 */
export async function loadForecastAuditEvents(
  limit = 5000
): Promise<ForecastAuditEvent[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("forecast_audit_events")
    .select(EVENT_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.warn("[loadForecastAuditEvents]", error.message);
    return [];
  }
  return (data ?? []).map(mapEvent);
}

/**
 * Closed quotations (won / lost) that carried a forecast — the outcome
 * side of the accuracy analytics (win rate by probability, optimism /
 * conservatism). `forecast_probability` on a closed doc is the last
 * probability it held.
 */
export type ClosedForecastDeal = {
  id: string;
  number: string | null;
  status: "won" | "lost";
  total: number;
  currency: string;
  probability: number | null;
  ownerId: string | null;
  expectedCloseDate: string | null;
};

export async function loadClosedForecastDeals(): Promise<ClosedForecastDeal[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("documents")
    .select(
      "id, number, status, total_price, currency, forecast_probability, " +
        "forecast_expected_close_date, sales_owner_id, created_by"
    )
    .in("status", ["won", "lost"])
    .not("forecast_probability", "is", null);
  if (error) {
    console.warn("[loadClosedForecastDeals]", error.message);
    return [];
  }
  return (data ?? []).map((d: any) => ({
    id: d.id,
    number: d.number ?? null,
    status: d.status as "won" | "lost",
    total: Number(d.total_price || 0),
    currency: (d.currency ?? "USD") as string,
    probability: d.forecast_probability ?? null,
    ownerId: (d.sales_owner_id ?? d.created_by ?? null) as string | null,
    expectedCloseDate: d.forecast_expected_close_date ?? null,
  }));
}
