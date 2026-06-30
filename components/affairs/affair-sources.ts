// Affair source vocabulary — the commercial ORIGIN of a deal (m102, revised
// m125 for the 2026-06-17 CRM refactor). Shared by the create panel, the
// affair page and the pipeline views. Keep in sync with the
// affairs_source_check DB constraint (m125) and the AFFAIR_SOURCES list in
// app/(app)/affairs/actions.ts.

export const AFFAIR_SOURCE_OPTIONS = [
  { value: "tender", label: "Tender" },
  { value: "prospecting", label: "Prospecting" },
  { value: "referral", label: "Referral" },
  { value: "existing_customer_opportunity", label: "Existing Customer Opportunity" },
  { value: "partner", label: "Partner" },
  { value: "website_inquiry", label: "Website Inquiry" },
  { value: "exhibition_event", label: "Exhibition / Event" },
  { value: "direct_request", label: "Direct Request" },
  { value: "other", label: "Other" },
] as const;

export type AffairSource = (typeof AFFAIR_SOURCE_OPTIONS)[number]["value"];

export function affairSourceLabel(v: string | null | undefined): string | null {
  if (!v) return null;
  return AFFAIR_SOURCE_OPTIONS.find((o) => o.value === v)?.label ?? v;
}
