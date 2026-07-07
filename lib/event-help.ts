// =====================================================================
// Event contextual help — plain-language business explanation for every
// emitted event. Written for BUSINESS users (not developers): what the
// technical key `po.created` actually means, why anyone would care, and
// who is normally interested.
//
// Consumed by the Event Registry admin UI (index tooltip + per-event
// header). Pure data — no runtime effect on emission or routing. Typed as
// Record<EventType, EventHelp> so a new event that lacks help fails the
// build (drift is impossible; a test also locks 1:1 coverage with the
// catalog).
// =====================================================================

import type { EventType } from "./events-shared.ts";

export type EventHelp = {
  /** "When does this happen?" — the business trigger, one sentence. */
  when: string;
  /** "Why would someone care?" — the reason the event exists. */
  why: string;
  /** "Typical recipients" — roles normally interested, in priority order.
   *  Rendered arrow-joined (e.g. Operations → Sales → Admin). */
  recipients: readonly string[];
};

/**
 * One entry per emitted event. Keep the wording business-first: describe
 * the real-world moment, not the code path.
 */
export const EVENT_HELP: Record<EventType, EventHelp> = {
  // ---------------------------------------------------------------- production_order
  "po.created": {
    when: "A production order is generated — usually right after a quotation is marked Won and production is launched.",
    why: "Operations now needs to start preparing the manufacturing and the factory hand-off.",
    recipients: ["Operations", "Sales", "Admin"],
  },
  "po.status_changed": {
    when: "A production order moves to a new stage (for example: in production, ready to ship).",
    why: "Everyone tracking the order can see where it stands without asking.",
    recipients: ["Operations", "Sales"],
  },
  "po.deadline_changed": {
    when: "The promised production or delivery date on an order is changed.",
    why: "A moved deadline affects what was promised to the client and the shipping plan.",
    recipients: ["Operations", "Sales", "Sales director"],
  },
  "po.delay_event_edited": {
    when: "A recorded delay on an order is edited.",
    why: "The delay history feeds client updates and on-time performance — changes matter.",
    recipients: ["Operations", "Task list manager"],
  },
  "po.delay_event_deleted": {
    when: "A recorded delay is removed from an order.",
    why: "Deleting a delay rewrites the order's history, so it is worth noticing.",
    recipients: ["Operations", "Admin"],
  },
  "po.timeline_set": {
    when: "The production timeline (start, milestones, end) is set for an order.",
    why: "The timeline drives scheduling and the At-Risk view.",
    recipients: ["Operations"],
  },
  "po.deposit_received": {
    when: "The client's deposit for the order is recorded as received.",
    why: "Production can officially begin once the deposit is in.",
    recipients: ["Finance", "Operations", "Sales"],
  },
  "po.balance_received": {
    when: "The remaining balance for the order is recorded as paid.",
    why: "The order is now fully paid — it can be cleared for shipping and closing.",
    recipients: ["Finance", "Sales"],
  },
  "po.deposit_override": {
    when: "Production is started before the deposit was received — a deliberate manual override.",
    why: "This is a financial risk: work begins without payment secured, so it should be seen by management.",
    recipients: ["Sales director", "Finance", "Admin"],
  },
  "po.shipment_updated": {
    when: "Shipping details for the order change (booking, container, tracking or dates).",
    why: "Sales and the client rely on accurate, up-to-date shipping status.",
    recipients: ["Operations", "Sales"],
  },
  "po.production_completed": {
    when: "The factory finishes producing the order.",
    why: "The order can move on to shipping and the client can be updated.",
    recipients: ["Operations", "Sales"],
  },
  "po.bl_info_requested": {
    when: "Operations asks Sales for the shipping / Bill of Lading details needed to ship.",
    why: "Missing shipping info blocks the shipment — Sales needs to respond quickly.",
    recipients: ["Sales", "Sales director"],
  },
  "po.bl_info_resolved": {
    when: "The requested shipping / Bill of Lading details are provided.",
    why: "Operations is unblocked and can proceed with the shipment.",
    recipients: ["Operations"],
  },
  "po.cancelled": {
    when: "A production order is cancelled.",
    why: "A cancellation stops all work on the order and can have financial impact.",
    recipients: ["Operations", "Sales", "Sales director", "Admin"],
  },

  // ---------------------------------------------------------------- task_list
  "tl.submitted_for_validation": {
    when: "A task list is submitted for technical validation before production.",
    why: "The task list manager needs to review it and release it for production.",
    recipients: ["Task list manager", "Operations"],
  },
  "tl.validated": {
    when: "A task list passes technical validation.",
    why: "The list is cleared for production — the next steps can proceed.",
    recipients: ["Operations", "Sales"],
  },
  "tl.production_ready": {
    when: "A validated task list is marked ready for production.",
    why: "The factory hand-off can start.",
    recipients: ["Operations"],
  },
  "tl.needs_revision": {
    when: "A reviewer sends a task list back for changes.",
    why: "The author must fix the flagged issues before it can move forward.",
    recipients: ["Sales", "Operations"],
  },
  "tl.reopened": {
    when: "A closed task list is reopened.",
    why: "Reopening means more work is expected on something thought to be finished.",
    recipients: ["Operations", "Task list manager"],
  },
  "tl.cancelled": {
    when: "A task list is cancelled.",
    why: "Cancelling stops the planned production work.",
    recipients: ["Operations", "Sales", "Admin"],
  },
  "tl.deleted": {
    when: "A task list is deleted.",
    why: "Deletion is permanent and removes the production plan — high impact.",
    recipients: ["Admin", "Operations"],
  },
  "tl.status_overridden": {
    when: "Someone manually forces a task list into a different status.",
    why: "A manual override bypasses the normal workflow and is worth auditing.",
    recipients: ["Task list manager", "Admin"],
  },
  "tl.header_changed": {
    when: "The task list's header details (title, references) are edited.",
    why: "Routine bookkeeping — usually just informational.",
    recipients: ["Operations"],
  },

  // ---------------------------------------------------------------- document (quotation)
  "doc.created": {
    when: "A new quotation is created.",
    why: "Gives the commercial team early visibility of new activity.",
    recipients: ["Sales", "Sales director"],
  },
  "doc.updated": {
    when: "A quotation is edited.",
    why: "Routine tracking of changes to an offer.",
    recipients: ["Sales"],
  },
  "doc.status_changed": {
    when: "A quotation changes status (draft, sent, and so on).",
    why: "Follows the deal's progress through the pipeline.",
    recipients: ["Sales", "Sales director"],
  },
  "doc.won": {
    when: "A quotation is marked Won.",
    why: "A won deal triggers production and counts toward revenue.",
    recipients: ["Sales", "Sales director", "Operations", "Finance"],
  },
  "doc.lost": {
    when: "A quotation is marked Lost.",
    why: "Closes the opportunity and feeds win/loss analysis.",
    recipients: ["Sales", "Sales director"],
  },
  "doc.cancelled": {
    when: "A quotation is cancelled.",
    why: "A cancelled offer stops any further follow-up.",
    recipients: ["Sales", "Sales director", "Admin"],
  },
  "doc.deleted": {
    when: "A quotation is deleted.",
    why: "Deletion is permanent — high impact on the commercial record.",
    recipients: ["Admin", "Sales director"],
  },
  "doc.validation_requested": {
    when: "A quotation needs approval (for example a discount or margin) before it can be sent.",
    why: "The approver must review it before Sales can proceed.",
    recipients: ["Sales director", "Admin"],
  },
  "doc.validation_approved": {
    when: "A quotation's approval is granted.",
    why: "Sales is cleared to send the offer to the client.",
    recipients: ["Sales"],
  },
  "doc.validation_rejected": {
    when: "A quotation's approval is refused and changes are requested.",
    why: "Sales must revise the offer before resubmitting it.",
    recipients: ["Sales"],
  },
  "doc.shipping_update_requested": {
    when: "Sales asks Operations to refresh the transport cost of a document.",
    why: "Operations must quote the freight again before the offer goes out.",
    recipients: ["Operations"],
  },
  "doc.shipping_update_completed": {
    when: "Operations enters the new freight and completes the request.",
    why: "The requester gets the refreshed shipping cost on their document.",
    recipients: ["Sales"],
  },
  "doc.shipping_update_cancelled": {
    when: "A shipping update request is withdrawn or declined.",
    why: "Keeps the document timeline honest about abandoned refreshes.",
    recipients: ["Sales"],
  },

  // ---------------------------------------------------------------- client
  "client.created": {
    when: "A new client is added to the system.",
    why: "The new account becomes visible to the commercial team.",
    recipients: ["Sales", "Sales director"],
  },
  "client.updated": {
    when: "A client's details are edited.",
    why: "Routine record-keeping on the account.",
    recipients: ["Sales"],
  },
  "client.deleted": {
    when: "A client is deleted.",
    why: "Deletion is permanent and affects all linked history — high impact.",
    recipients: ["Admin", "Sales director"],
  },
  "client.contact_added": {
    when: "A contact is added to a client.",
    why: "Routine bookkeeping on the account.",
    recipients: ["Sales"],
  },
  "client.contact_updated": {
    when: "A client contact's details change.",
    why: "Routine bookkeeping on the account.",
    recipients: ["Sales"],
  },
  "client.contact_deleted": {
    when: "A contact is removed from a client.",
    why: "Routine bookkeeping on the account.",
    recipients: ["Sales"],
  },

  // ---------------------------------------------------------------- historical import
  "import.batch_completed": {
    when: "A batch of historical invoices finishes importing for a client.",
    why: "Confirms the client's past commercial history has been reconstructed.",
    recipients: ["Sales", "Admin"],
  },

  // ---------------------------------------------------------------- affair
  "affair.action_planned": {
    when: "A next action is scheduled on an affair (a client project).",
    why: "Keeps the account's follow-up plan on track.",
    recipients: ["Sales"],
  },
  "affair.action_done": {
    when: "A planned action on an affair is completed.",
    why: "Records progress on the account.",
    recipients: ["Sales"],
  },
  "affair.action_deleted": {
    when: "A planned action is removed from an affair.",
    why: "Routine bookkeeping on the follow-up plan.",
    recipients: ["Sales"],
  },
  "affair.bl_info_requested": {
    when: "Shipping / Bill of Lading information is requested against an affair's history.",
    why: "Keeps the affair's shipping record complete.",
    recipients: ["Sales", "Operations"],
  },

  // ---------------------------------------------------------------- project_request (Service Request)
  "pr.created": {
    when: "A service request (a client need) is drafted.",
    why: "The starting point of the request-to-quote workflow.",
    recipients: ["Sales"],
  },
  "pr.submitted": {
    when: "A service request is submitted for approval.",
    why: "The sales director must approve it before it goes to operations.",
    recipients: ["Sales director"],
  },
  "pr.approved": {
    when: "A service request is approved.",
    why: "Operations can start scoping cost and logistics.",
    recipients: ["Operations"],
  },
  "pr.rejected": {
    when: "A service request is rejected.",
    why: "The owner must rework the request or drop it.",
    recipients: ["Sales"],
  },
  "pr.info_requested": {
    when: "A reviewer asks for more information on a request.",
    why: "The sales owner must supply the missing details before it can move on.",
    recipients: ["Sales"],
  },
  "pr.cost_entered": {
    when: "The factory cost for a request is entered.",
    why: "The director can review the pricing inputs.",
    recipients: ["Sales director"],
  },
  "pr.cost_overridden": {
    when: "Someone overrides the factory cost on a request.",
    why: "A cost override changes the margin and is worth auditing.",
    recipients: ["Sales director", "Admin"],
  },
  "pr.logistics_entered": {
    when: "Logistics details are entered on a request.",
    why: "Moves the request toward a complete cost picture.",
    recipients: ["Operations"],
  },
  "pr.packing_entered": {
    when: "The packing list for a request is entered.",
    why: "Packing feeds the freight calculation — the director can review it.",
    recipients: ["Sales director", "Operations"],
  },
  "pr.freight_entered": {
    when: "The freight cost for a request is entered.",
    why: "Completes the landed-cost picture needed for pricing.",
    recipients: ["Sales director"],
  },
  "pr.freight_update_requested": {
    when: "An updated freight quote is requested.",
    why: "Operations must refresh the freight figure.",
    recipients: ["Operations"],
  },
  "pr.freight_updated": {
    when: "The freight figure is updated.",
    why: "Sales gets the refreshed cost to use in the offer.",
    recipients: ["Sales"],
  },
  "pr.ready_for_pricing": {
    when: "A request has all its inputs and is ready to be priced.",
    why: "Pricing can now build the final price.",
    recipients: ["Sales director"],
  },
  "pr.priced": {
    when: "A service request is priced.",
    why: "Sales can turn the price into a quotation.",
    recipients: ["Sales"],
  },
  "pr.quotation_generated": {
    when: "A quotation is generated from a service request.",
    why: "The request becomes a real commercial offer.",
    recipients: ["Sales"],
  },
  "pr.won": {
    when: "A service request is won.",
    why: "Triggers downstream production, just like a won quotation.",
    recipients: ["Sales", "Operations"],
  },
  "pr.lost": {
    when: "A service request is lost.",
    why: "Closes the request and feeds win/loss analysis.",
    recipients: ["Sales", "Sales director"],
  },
  "pr.cancelled": {
    when: "A service request is cancelled.",
    why: "Stops any further work on the request.",
    recipients: ["Sales", "Operations", "Admin"],
  },

  // ---------------------------------------------------------------- admin / system
  "admin.permissions_changed": {
    when: "The permissions matrix is changed.",
    why: "Security-sensitive: who is allowed to do what has just changed.",
    recipients: ["Super admin", "Admin"],
  },
  "admin.user_role_changed": {
    when: "A user's role is changed.",
    why: "Security-sensitive: someone's access level has just changed.",
    recipients: ["Super admin", "Admin"],
  },
  "system.dev_reset": {
    when: "Developer / test data is reset.",
    why: "A destructive maintenance action — everyone should know it happened.",
    recipients: ["Super admin", "Admin"],
  },
};

/** Safe lookup — returns null for an unknown key (defensive; the type
 *  makes a missing catalog key impossible at build time). */
export function getEventHelp(eventKey: string): EventHelp | null {
  return (EVENT_HELP as Record<string, EventHelp>)[eventKey] ?? null;
}
