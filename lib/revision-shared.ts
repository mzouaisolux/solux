/**
 * Revision-loop shared types/labels for the Task List Manager ↔ Sales
 * Factory-Mapping workflow (D1).
 *
 * Pure module — safe to import from both client and server. It does NOT
 * touch the Factory Mapping model (global / client / order mappings); it
 * only structures the "Request revision" ↔ "Re-submit" hand-off that sits
 * on top of the existing entity_messages conversation (m049).
 *
 * Storage (no migration): a revision request is an `entity_messages` row
 * with `message_kind: 'request'` + `structured_payload: RevisionPayload`.
 * A sales response is a `message_kind: 'reply'` row whose `parent_message_id`
 * points at the request. `request_type` is left null (its CHECK list is
 * reserved for ops/packing/lead-time requests — we don't extend it here).
 */

export type RevisionCategory =
  | "missing_information"
  | "inconsistent_information"
  | "product_clarification"
  | "configuration_correction"
  | "other";

export const REVISION_CATEGORIES: { value: RevisionCategory; label: string }[] = [
  { value: "missing_information", label: "Missing information" },
  { value: "inconsistent_information", label: "Inconsistent information" },
  { value: "product_clarification", label: "Product clarification" },
  { value: "configuration_correction", label: "Configuration correction" },
  { value: "other", label: "Other" },
];

/** Optional scope: which field/area the clarification is about. "General
 *  task list" is the default. The product-specific scopes mirror the sales
 *  config fields so a request can target Battery / Optic / CCT etc. */
export const REVISION_FIELD_SCOPES: string[] = [
  "General task list",
  "Battery",
  "Optic",
  "CCT",
  "Solar panel",
  "Controller / Sensor",
  "Color / RAL",
  "Packaging",
  "Other product / configuration",
];

export const REVISION_DEFAULT_SCOPE = "General task list";

export function isRevisionCategory(v: unknown): v is RevisionCategory {
  return REVISION_CATEGORIES.some((c) => c.value === v);
}

export function revisionCategoryLabel(v: string | null | undefined): string {
  return REVISION_CATEGORIES.find((c) => c.value === v)?.label ?? "Revision";
}

/** Shape stored in entity_messages.structured_payload for the revision loop. */
export type RevisionPayload = {
  kind: "revision_request" | "revision_response";
  category?: RevisionCategory | null;
  field?: string | null;
};

/** A request/response surfaced to the banners (resolved server-side from
 *  entity_messages). Kept minimal + serializable for the client component. */
export type RevisionThreadInfo = {
  /** Latest revision request on the task list (open or not), if any. */
  request: {
    category: RevisionCategory | null;
    categoryLabel: string;
    field: string | null;
    message: string;
    authorName: string | null;
    createdAt: string;
    resolved: boolean;
  } | null;
  /** Latest sales response, if any. */
  response: {
    message: string;
    authorName: string | null;
    createdAt: string;
  } | null;
};
