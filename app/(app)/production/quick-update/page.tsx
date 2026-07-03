import { createClient } from "@/lib/supabase/server";
import { getEffectiveRole } from "@/lib/auth";
import { hasUiCapability } from "@/lib/permissions";
import AccessDenied from "@/components/AccessDenied";
import { getVisibilityScope, canSeeRecord } from "@/lib/visibility";
import { resolveUserLabels } from "@/lib/user-display";
import { todayISO } from "@/lib/working-days";
import {
  computeExpectedDeposit,
  computeExpectedBalance,
  computeProductionPaymentState,
  type ProductionOrder,
  type PaymentMode,
  type PaymentTerms,
} from "@/lib/types";
import { computeOperationsAlert } from "@/lib/operations-alerts";
import { computeDelayBreakdown, type DeadlineChangeRow } from "@/lib/delays";
import { normalizeShippingDetails } from "@/lib/shipping";
import { normalizeBlProfile, blProfileStatus } from "@/lib/bl";
import {
  requiredShippingDocs,
  computeShippingDocsReadiness,
} from "@/lib/shipping-docs";
import type { QuickUpdateRow } from "@/lib/quick-update-columns";
import { QuickUpdateTable } from "./QuickUpdateTable";

/**
 * Operations — Quick Update workspace.
 *
 * An additive, execution-focused sibling of /operations and the order detail
 * page (both untouched). A single full-width spreadsheet where Operations
 * edits dozens of production orders inline, auto-saving each cell — "update 40
 * orders in 10 minutes without opening 40 pages".
 *
 * Server responsibilities (here): auth/capability gate, one wide fetch, the
 * visibility scope, and ALL derivations (payment state, alert, delay split,
 * doc readiness) done ONCE with the existing pure helpers. The client only
 * renders + auto-saves; it never re-derives money or re-queries Supabase.
 */

// Always fresh — this is an editing surface; revalidatePath handles updates,
// but force-dynamic guarantees the first paint reflects reality.
export const dynamic = "force-dynamic";

export default async function QuickUpdatePage() {
  const { userId, effectiveRole } = await getEffectiveRole();

  // Gate: anyone who can edit ANY production-order facet gets the workspace
  // (Operations / TLM / admin). Sales / finance land on Access Denied — they
  // keep their read-only /operations view. Backend actions re-check per field.
  const [canStatus, canShipment, canPayments, canDeadline] = await Promise.all([
    hasUiCapability("production_order.edit_status"),
    hasUiCapability("production_order.edit_shipment"),
    hasUiCapability("production_order.edit_payments"),
    hasUiCapability("production_order.edit_deadline"),
  ]);
  if (!(canStatus || canShipment || canPayments || canDeadline)) {
    return (
      <AccessDenied
        capability="production_order.edit_status"
        title="Quick Update is the Operations execution workspace."
        message="You need a production-order editing capability to use it. The read-only order list stays available under Orders."
      />
    );
  }

  const supabase = createClient();

  // One wide fetch. `*` carries every order column (incl. shipping_details jsonb,
  // commercial_invoice_number, balance_due_date, lc_expiry_date). The joined doc
  // brings pricing + sales owner; the client brings identity + BL profile.
  const { data: rawOrders, error } = await supabase
    .from("production_orders")
    .select(
      `
      *,
      task_lists:task_list_id(number),
      documents:quotation_id(
        id, number, total_price, currency, payment_mode, payment_terms,
        incoterm, created_by, sales_owner_id,
        clients:client_id(id, company_name, country, client_code, bl_profile)
      )
      `
    )
    .order("production_validation_date", { ascending: false, nullsFirst: false });

  if (error) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4">
          <h1 className="text-base font-semibold text-rose-900">
            Could not load production orders.
          </h1>
          <p className="text-sm text-rose-800 mt-1">{error.message}</p>
        </div>
      </div>
    );
  }

  // Visibility scope (m067) — same rule as /operations. Owner of an order = the
  // quotation's sales_owner_id (m066) when set, else its creator.
  const visScope = await getVisibilityScope(userId, effectiveRole);
  const ownerOf = (o: any): string | null =>
    o?.documents?.sales_owner_id ?? o?.documents?.created_by ?? null;
  const visible = ((rawOrders ?? []) as any[])
    .filter((o) => canSeeRecord(visScope, { ownerId: ownerOf(o), kind: "order" }))
    // Active workspace: archived orders are out of scope for daily updates.
    .filter((o) => !o.archived_at);

  const orderIds = visible.map((o) => o.id);

  // Delay events — one query, grouped, for the Factory / External split.
  const delayByOrder = new Map<string, DeadlineChangeRow[]>();
  if (orderIds.length) {
    const { data: delayRows } = await supabase
      .from("production_deadline_changes")
      .select(
        "production_order_id, previous_date, new_date, delay_type, days_added, reason, created_at"
      )
      .in("production_order_id", orderIds);
    for (const d of (delayRows ?? []) as any[]) {
      const arr = delayByOrder.get(d.production_order_id) ?? [];
      arr.push(d as DeadlineChangeRow);
      delayByOrder.set(d.production_order_id, arr);
    }
  }

  // Present document kinds — one query, grouped, for the docs readiness badge.
  const presentByOrder = new Map<string, Set<string>>();
  if (orderIds.length) {
    const { data: docRows } = await supabase
      .from("order_documents")
      .select("production_order_id, kind, archived_at")
      .in("production_order_id", orderIds);
    for (const d of (docRows ?? []) as any[]) {
      if (d.archived_at || !d.kind) continue;
      const set = presentByOrder.get(d.production_order_id) ?? new Set<string>();
      set.add(d.kind);
      presentByOrder.set(d.production_order_id, set);
    }
  }

  // Sales labels (display names — RLS-safe fallback to "Role · uuid").
  const salesLabels = await resolveUserLabels(visible.map(ownerOf));

  const today = todayISO();

  const rows: QuickUpdateRow[] = visible.map((o: any) => {
    const doc = o.documents ?? {};
    const client = doc.clients ?? {};
    const totalPrice = Number(doc.total_price ?? 0);
    const paymentMode = (doc.payment_mode ?? null) as PaymentMode | null;
    const paymentTerms = (doc.payment_terms ?? null) as PaymentTerms | null;
    const depositReceived = Number(o.deposit_received_amount ?? 0);
    const balanceReceived = Number(o.balance_received_amount ?? 0);
    const expectedDeposit = computeExpectedDeposit(
      totalPrice,
      paymentMode,
      paymentTerms
    );
    const expectedBalance = computeExpectedBalance(
      totalPrice,
      paymentMode,
      paymentTerms
    );
    const paymentState = computeProductionPaymentState({
      totalPrice,
      paymentMode,
      paymentTerms,
      depositReceived,
      balanceReceived,
    });
    const alert = computeOperationsAlert({
      order: o as ProductionOrder,
      totalPrice,
      paymentMode,
      paymentTerms,
      today,
    });
    const dl = computeDelayBreakdown(delayByOrder.get(o.id) ?? []);
    const ship = normalizeShippingDetails(o.shipping_details ?? null);
    const blProfile = normalizeBlProfile(client.bl_profile ?? null, doc.currency ?? "USD");
    const reqs = requiredShippingDocs({
      paymentMode,
      blDocuments: blProfile.documents.map((d) => ({
        key: d.key,
        included: d.included,
      })),
    });
    const readiness = computeShippingDocsReadiness(
      reqs,
      presentByOrder.get(o.id) ?? []
    );
    const ownerId = ownerOf(o);

    return {
      id: o.id,
      number: o.number ?? "—",
      detailHref: `/production/orders/${o.id}`,
      clientName: client.company_name ?? "—",
      clientCode: client.client_code ?? null,
      country: client.country ?? null,
      clientId: client.id ?? null,
      salesLabel: ownerId ? salesLabels.get(ownerId)?.label ?? null : null,
      salesOwnerId: ownerId,
      status: o.status,
      archived: false,
      currency: doc.currency ?? "USD",
      paymentState,
      expectedDeposit,
      depositReceived,
      expectedBalance,
      balanceReceived,
      balanceRemaining: Math.max(0, expectedBalance - balanceReceived),
      depositReceivedAt: o.deposit_received_at ?? null,
      balanceReceivedAt: o.balance_received_at ?? null,
      balanceDueDate: o.balance_due_date ?? null,
      lcExpiryDate: o.lc_expiry_date ?? null,
      paymentNotes: o.payment_notes ?? null,
      initialDeadline: o.initial_production_deadline ?? null,
      currentEta: o.current_production_deadline ?? null,
      factoryDelayDays: dl.factoryDays,
      externalDelayDays: dl.externalDays,
      shipmentBooked: !!o.shipment_booked,
      etd: o.etd ?? null,
      eta: o.eta ?? null,
      carrier: ship.forwarder,
      bookingNumber: ship.booking_number,
      containerNumber: ship.container_number,
      trackingUrl: ship.tracking_url,
      blNumber: ship.bl_number,
      blStatus: blProfileStatus(blProfile),
      ciNumber: o.commercial_invoice_number ?? null,
      docsReady: readiness.requiredReady,
      docsTotal: readiness.requiredTotal,
      notes: o.shipping_notes ?? null,
      alertLevel: alert.level,
      alertLabel: alert.label,
      updatedAt: o.updated_at ?? null,
    };
  });

  return (
    <QuickUpdateTable
      rows={rows}
      today={today}
      currentUserId={userId ?? null}
      caps={{
        status: canStatus,
        shipment: canShipment,
        payments: canPayments,
        deadline: canDeadline,
      }}
    />
  );
}
