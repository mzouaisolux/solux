// =====================================================================
// Tender shared vocabulary — types, labels and pure helpers used by the
// inbox (TendersManager), the pipeline board (TenderPipeline) and the
// drawer (TenderDrawer). No "use client": pure module.
// =====================================================================

import { ACTIVE_PIPELINE } from "@/components/prospects/tender-status";

/* ---------------------------------- types ---------------------------------- */

export type TenderDoc = { type: string; name: string; imported: boolean; url?: string | null };
export type TenderActionRow = {
  id: string;
  action_type: string;
  title: string | null;
  due_date: string;
  done_at: string | null;
};
export type TenderFollowupRow = {
  id: string;
  tender_id: string;
  kind: string;
  comment: string;
  created_at: string;
};
export type ParticipantRow = {
  id: string;
  tender_id: string;
  company_name: string;
  country: string | null;
  is_winner: boolean;
  bid_value: number | null;
  notes: string | null;
  promoted_prospect_id: string | null;
};
export type TenderMRow = {
  id: string;
  title: string;
  reference: string | null;
  country: string | null;
  city: string | null;
  buyer: string | null;
  platform: string | null;
  source_url: string | null;
  publication_date: string | null;
  type: "open" | "result";
  value: number | null;
  currency: string | null;
  budget_usd: number | null;
  deadline: string | null;
  notes: string | null;
  status: string;
  commercial_status: string;
  score: number | null;
  relevance: string | null;
  solar_confirmed: boolean | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  contact_phone2: string | null;
  specs: Record<string, unknown>;
  documents: TenderDoc[];
  owner_id: string | null;
  attached_client_id: string | null;
  attached_prospect_id: string | null;
  converted_affair_id: string | null;
  imported_at: string | null;
  last_import_at: string | null;
  // m110 qualification
  accepted_at: string | null;
  rejected_reason: string | null;
  rejected_comment: string | null;
  rejected_at: string | null;
  converted_at: string | null;
  attachedName: string | null;
  participants: ParticipantRow[];
  actions: TenderActionRow[];
  followups: TenderFollowupRow[];
};
export type CompanyOption = { id: string; name: string };
export type OwnerOption = { id: string; name: string };

/** Signature of the toast-wrapped server-action runner shared by the
 *  inbox / pipeline / drawer components. */
export type ActFn = (
  fn: (fd: FormData) => Promise<void>,
  fd: FormData,
  ok?: string
) => Promise<void>;

/* ------------------------------ label maps -------------------------------- */

export const REJECT_REASON_LABEL: Record<string, string> = {
  budget_too_small: "Budget too small",
  outside_target_market: "Outside our target market",
  already_awarded: "Already awarded",
  specification_not_suitable: "Specification not suitable",
  no_local_partner: "No local partner available",
  political_country_risk: "Political / country risk",
  duplicate_tender: "Duplicate tender",
  not_strategic: "Not strategic",
  other: "Other",
};

/** m111 — commercial journal vocabulary. Logging an entry auto-advances
 *  the pipeline (server side): contact/email/meeting → Contacted,
 *  waiting feedback → Waiting Feedback, interested / technical →
 *  Interested, quotation requested → Project Request, not interested
 *  → back to Searching Partner. */
export const FOLLOWUP_KIND_LABEL: Record<string, string> = {
  contact_attempt: "Contact attempt",
  email_sent: "Email sent",
  meeting: "Meeting",
  interested: "Interested",
  not_interested: "Not interested",
  waiting_feedback: "Waiting feedback",
  technical_discussion: "Technical discussion",
  quotation_requested: "Quotation requested",
  // legacy (m110)
  communication: "Communication",
  feedback: "Feedback",
  progress: "Commercial progress",
};
/** Kinds offered in the journal form (legacy ones stay display-only). */
export const FOLLOWUP_FORM_KINDS = [
  "contact_attempt", "email_sent", "meeting", "interested",
  "not_interested", "waiting_feedback", "technical_discussion",
  "quotation_requested",
] as const;

export const ACTION_TYPE_OPTIONS = [
  { value: "call", label: "Call" },
  { value: "meeting", label: "Meeting" },
  { value: "visit", label: "Site visit" },
  { value: "follow_up", label: "Follow-up" },
  { value: "send_quote", label: "Send quote" },
  { value: "other", label: "Other" },
] as const;

/* ------------------------------ spec helpers ------------------------------ */

/** Known spec keys get nice labels (English AND the French keys produced
 *  by "Solux AO Live"); anything else is prettified — the layout is never
 *  hardcoded to a fixed field list. */
export const SPEC_LABEL: Record<string, string> = {
  led_power: "LED Power",
  solar_panel_power: "Solar Panel Power",
  pole_height: "Pole Height",
  ip_rating: "IP Rating",
  autonomy: "Autonomy",
  quantity: "Quantity",
  lumens: "Lumens",
  warranty: "Warranty",
  certifications: "Certifications",
  // Solux AO Live (French) keys
  puissance_led_w: "LED Power (W)",
  puissance_panneau_w: "Solar Panel Power (W)",
  hauteur_poteau_m: "Pole Height (m)",
  ip_protection: "IP Rating",
  autonomie_jours: "Autonomy (days)",
  quantite_totale: "Quantity",
  flux_lumineux_lm: "Lumens",
  garantie_ans: "Warranty (years)",
  couleur_temperature_k: "Color Temp. (K)",
  type_produit: "Product Type",
  lots: "Lots",
  descriptif: "Description",
  note_specs: "Spec note",
  specifications_brutes: "Raw specifications",
  source_doc: "Spec source",
  extraction_methode: "Extraction method",
};
export const prettify = (k: string) =>
  SPEC_LABEL[k] ?? k.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** Render any spec value readably: scalars as-is, arrays joined, arrays of
 *  objects (e.g. `lots`) as compact lines, plain objects as key: value. */
export function specValueToText(v: unknown): string {
  if (v == null) return "—";
  if (Array.isArray(v)) {
    return v
      .map((x) =>
        x != null && typeof x === "object"
          ? Object.values(x as Record<string, unknown>).filter(Boolean).join(" — ")
          : String(x)
      )
      .join(" · ");
  }
  if (typeof v === "object") {
    return Object.entries(v as Record<string, unknown>)
      .map(([k, x]) => `${prettify(k)}: ${String(x)}`)
      .join(" · ");
  }
  return String(v);
}
/** Long free-text specs (raw extracts, notes) render full-width. */
export const isLongSpec = (k: string, text: string) =>
  ["specifications_brutes", "note_specs", "descriptif"].includes(k) || text.length > 90;

/** Spec keys promoted to VISUAL CARDS — big value, small label. */
export const SPEC_CARDS: Record<string, { label: string; unit?: string }> = {
  puissance_led_w: { label: "LED Power", unit: "W" },
  led_power: { label: "LED Power" },
  puissance_panneau_w: { label: "Solar Panel", unit: "W" },
  solar_panel_power: { label: "Solar Panel" },
  hauteur_poteau_m: { label: "Pole Height", unit: "m" },
  pole_height: { label: "Pole Height" },
  ip_protection: { label: "Protection" },
  ip_rating: { label: "Protection" },
  autonomie_jours: { label: "Autonomy", unit: " days" },
  autonomy: { label: "Autonomy" },
  quantite_totale: { label: "Quantity" },
  quantity: { label: "Quantity" },
  flux_lumineux_lm: { label: "Lumens", unit: " lm" },
  lumens: { label: "Lumens" },
  garantie_ans: { label: "Warranty", unit: " yrs" },
  warranty: { label: "Warranty" },
  couleur_temperature_k: { label: "Color Temp.", unit: "K" },
};

/* ------------------------------ misc helpers ------------------------------ */

export const todayISO = () => new Date().toISOString().slice(0, 10);
export const daysLeft = (deadline: string | null): number | null => {
  if (!deadline) return null;
  const d = Date.parse(deadline + "T00:00:00Z");
  const t = Date.parse(todayISO() + "T00:00:00Z");
  if (!Number.isFinite(d)) return null;
  return Math.round((d - t) / 86_400_000);
};
export const money = (n: number | null, cur?: string | null) =>
  n == null
    ? "—"
    : `${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}${cur ? ` ${cur}` : ""}`;

/** Compact USD for cockpit tiles — "$35M" / "$118k". */
export const compactUsd = (n: number) =>
  n >= 1_000_000_000
    ? `$${(n / 1_000_000_000).toFixed(1)}B`
    : n >= 1_000_000
      ? `$${(n / 1_000_000).toFixed(1)}M`
      : n >= 1_000
        ? `$${Math.round(n / 1_000)}k`
        : `$${Math.round(n)}`;

export type Classification = "priority" | "to_qualify" | "watchlist";
export const classify = (score: number | null): Classification =>
  score != null && score >= 80 ? "priority" : score != null && score >= 60 ? "to_qualify" : "watchlist";
export const CLASS_CHIP: Record<Classification, string> = {
  priority: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  to_qualify: "bg-amber-50 text-amber-800 ring-amber-300",
  watchlist: "bg-neutral-100 text-neutral-500 ring-neutral-200",
};

/** m110 critical rule — accepted tender with no upcoming next action. */
export function needsAction(t: TenderMRow): boolean {
  if (!ACTIVE_PIPELINE.has(t.commercial_status)) return false;
  const open = t.actions.filter((a) => !a.done_at).sort((a, b) => a.due_date.localeCompare(b.due_date));
  if (open.length === 0) return true;
  return open[0].due_date < todayISO();
}

export const inputCls =
  "mt-0.5 w-full rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-200";
export const smallSelect =
  "rounded border border-neutral-200 px-1.5 py-1 text-[12px] text-neutral-700 bg-white";

export function isNavError(e: any): boolean {
  const d = e?.digest;
  return typeof d === "string" && (d.startsWith("NEXT_REDIRECT") || d.startsWith("NEXT_NOT_FOUND"));
}
