"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import {
  normalizePaymentTerms,
  validatePaymentTerms,
} from "@/lib/payment";
import {
  toProductionColumns,
  totalFreight,
  validateProductionTime,
  shippingExtrasTotal,
  normalizeAdditionalCharges,
} from "@/lib/logistics";
import { commissionAmount } from "@/lib/commission";
import {
  parseDocumentNumber,
  formatDocumentNumber,
  highestVisibleSeq,
  isDocumentNumberCollision,
} from "@/lib/document-number";
import { requireCapability } from "@/lib/permissions";
import { emitEvent } from "@/lib/events";
import type {
  Currency,
  DocType,
  DocumentContainer,
  DocumentLine,
  Incoterm,
  PaymentMode,
  PaymentTerms,
  ProductionTime,
} from "@/lib/types";

export type SaveDocumentInput = {
  type: DocType;
  client_id: string | null;
  incoterm: Incoterm | null;
  currency: Currency;
  port_of_loading: string | null;
  port_of_destination: string | null;
  containers: DocumentContainer[];
  manual_pricing: boolean;
  payment_mode: PaymentMode;
  payment_terms: PaymentTerms;
  production_time: ProductionTime | null;
  /** Sales Terms — see migration 037. All optional / nullable; the
   *  validity fields fall back to DB defaults (30 / 7) when null. */
  warranty_years?: number | null;
  offer_validity_products_days?: number | null;
  offer_validity_transport_days?: number | null;
  /** Internal affair / project name (m056). Optional. */
  affair_name?: string | null;
  /** Link this document to a real project/affair (m076). Set when creating
   *  a quotation inside a project. Only applied on a fresh insert. */
  affair_id?: string | null;
  /** m134 — the client's original free-text need (read-only reminder), carried
   *  SR→quotation→proforma→task list. Never auto-parsed into config. */
  original_sales_request?: string | null;
  /** When set, this save is a REVISION of an existing quotation (m059):
   *  a new version within the same affair, not a fresh quotation. */
  revise_of?: string | null;
  /** When set, this save EDITS an existing draft in place — same number,
   *  same status, same owner; lines/containers are replaced wholesale.
   *  Only drafts may be edited this way (sent/won quotations are revised
   *  into a new version instead). Mutually exclusive with revise_of. */
  edit_of?: string | null;
  include_sales_conditions: boolean;
  sales_conditions_id: string | null;
  bank_account_id: string | null;
  purchase_order_number: string | null;
  commission_enabled: boolean;
  commission_percentage: number;
  commission_amount: number;
  commission_description: string | null;
  show_commission_in_pdf: boolean;
  /** Logistics extras (m146). Insurance = a single amount; additional_charges
   *  = repeatable {label, amount} rows (ECTN, BESC, FERI, inspection…). Both
   *  optional; added to total_price but NOT to the commission base. Persisted
   *  via the "newer columns" retry-without fallback so saving works even
   *  before m146 is applied. */
  insurance_cost?: number | null;
  additional_charges?: { label: string; amount: number }[];
  /** Advisory validation (m068): when true, flag the saved quote for a
   *  manager's review (sets it pending + emits the request event). Never
   *  blocks the save; soft-fails if m068 isn't applied. */
  request_validation?: boolean;
  validation_request_note?: string | null;
  lines: DocumentLine[];
};

/**
 * If the save asked for validation, flag the saved quote as pending and
 * emit the request event. ADVISORY — soft-fails (never blocks the save)
 * when m068 isn't applied yet.
 */
async function maybeRequestValidation(
  supabase: ReturnType<typeof createClient>,
  docId: string,
  input: SaveDocumentInput,
  userId: string,
  number: string | null
) {
  if (!input.request_validation) return;
  const note = (input.validation_request_note ?? "").trim() || null;
  const { error } = await supabase
    .from("documents")
    .update({
      validation_status: "pending",
      validation_requested_by: userId,
      validation_requested_at: new Date().toISOString(),
      validation_note: note,
      validation_reviewed_by: null,
      validation_reviewed_at: null,
      validation_review_note: null,
    })
    .eq("id", docId);
  if (error) {
    // m068 not applied (or transient) — don't block the save.
    console.warn("[saveDocument] validation request skipped:", error.message);
    return;
  }
  await emitEvent({
    entity_type: "document",
    entity_id: docId,
    event_type: "doc.validation_requested",
    message: `Validation requested on ${number ?? docId.slice(0, 8) + "…"}${
      note ? ` — ${note}` : ""
    }`,
    payload: { number, note },
    bestEffort: true,
  });
}

export async function saveDocument(
  input: SaveDocumentInput
): Promise<{ id: string; number: string | null }> {
  // Capability gate — gated by the real role (server-side enforcement).
  // The "+ New quotation" buttons are also hidden via hasUiCapability
  // for roles that can't create. This is the security layer.
  await requireCapability("quotation.create");

  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  if (!input.client_id) throw new Error("Please select a client");
  if (!input.lines.length) throw new Error("Add at least one product line");
  // BUSINESS RULE — a quotation/invoice cannot exist without an affaire
  // (projet). A fresh document must carry affair_id; a revision inherits it
  // (revise_of, m076 trigger) and an edit-in-place keeps its link (edit_of).
  if (!input.affair_id && !input.revise_of && !input.edit_of) {
    throw new Error(
      "Impossible d'enregistrer : ce document doit être rattaché à une affaire (projet)."
    );
  }

  const normalizedTerms = normalizePaymentTerms(
    input.payment_mode,
    input.payment_terms
  );
  const paymentErr = validatePaymentTerms(input.payment_mode, normalizedTerms);
  if (paymentErr) throw new Error(paymentErr);

  const productionErr = validateProductionTime(input.production_time);
  if (productionErr) throw new Error(productionErr);

  const validContainers = (input.containers ?? []).filter(
    (c) => c.quantity > 0 && c.unit_price >= 0
  );

  const freight_total = totalFreight(validContainers);
  const items_total = input.lines.reduce(
    (s, l) => s + Number(l.total_price || 0),
    0
  );
  const subtotal = items_total + freight_total;
  const commission_amount = commissionAmount(subtotal, {
    enabled: input.commission_enabled,
    percentage: input.commission_percentage,
  });
  // Logistics extras (m146) — insurance + additional charges. Non-commissionable
  // disbursements: added AFTER commission, never into its base. Normalized here
  // so the persisted rows and the total agree.
  const insurance_cost = Number(input.insurance_cost) || 0;
  const clean_charges = normalizeAdditionalCharges(input.additional_charges);
  const shipping_extras = shippingExtrasTotal(insurance_cost, clean_charges);
  const grand_total = subtotal + commission_amount + shipping_extras;

  const productionCols = toProductionColumns(input.production_time);
  const legacyFreightType =
    validContainers.length === 1
      ? validContainers[0].container_type
      : validContainers.length > 1
      ? "40ft HC"
      : null;

  // The customer-visible line + container row shapes are identical whether
  // we insert a fresh doc or replace an edited draft's rows. Built once.
  const buildLineRows = (docId: string) =>
    input.lines.map((l) => ({
      document_id: docId,
      // Coerce "" → null: a custom pole / free-text line has no catalogue
      // product, and "" is not a valid uuid.
      product_id: l.product_id || null,
      quantity: l.quantity,
      selected_options: l.selected_options,
      unit_price: l.unit_price,
      total_price: l.total_price,
      pricing_mode: l.pricing_mode,
      pricing_tier: l.pricing_tier,
      original_unit_price: l.original_unit_price,
      discount_type: l.discount_type,
      discount_value: l.discount_value,
      client_product_name: l.client_product_name || null,
      category_id: l.category_id ?? null, // m133 — line-level product family
      config_values: l.config_values ?? {},
      // m139 — commercial-price provenance / lock. Default from the mechanical
      // mode so every persisted line has an explicit, correct source even if an
      // older client omitted it (matches the migration's backfill rule).
      pricing_source:
        l.pricing_source ??
        (l.pricing_mode === "manual" ? "manual" : "catalogue"),
      source_project_request_id: l.source_project_request_id ?? null,
      approved_by: l.approved_by ?? null,
      approved_at: l.approved_at ?? null,
    }));

  // Insert lines, tolerating an environment where m139 is not yet applied:
  // on a 42703 for the new columns, retry with them stripped (today's shape).
  const m139Cols = /(pricing_source|source_project_request_id|approved_by|approved_at)/;
  const insertLineRows = async (docId: string) => {
    const rows = buildLineRows(docId);
    const attempt = await supabase.from("document_lines").insert(rows);
    if (attempt.error && m139Cols.test(attempt.error.message ?? "")) {
      const baseRows = rows.map(
        ({
          pricing_source,
          source_project_request_id,
          approved_by,
          approved_at,
          ...rest
        }) => rest
      );
      const fb = await supabase.from("document_lines").insert(baseRows);
      if (fb.error) throw new Error(fb.error.message);
      return;
    }
    if (attempt.error) throw new Error(attempt.error.message);
  };

  async function insertContainers(docId: string) {
    if (!validContainers.length) return;
    const baseRows = validContainers.map((c, i) => ({
      document_id: docId,
      container_type: c.container_type,
      quantity: c.quantity,
      unit_price: c.unit_price,
      position: i,
    }));
    const richRows = validContainers.map((c, i) => ({
      ...baseRows[i],
      wooden_box_cost:
        c.container_type === "LCL" ? Number(c.wooden_box_cost || 0) : 0,
    }));
    const attempt = await supabase
      .from("document_containers")
      .insert(richRows);
    if (attempt.error && /wooden_box_cost/.test(attempt.error.message ?? "")) {
      const fb = await supabase.from("document_containers").insert(baseRows);
      if (fb.error) throw new Error(fb.error.message);
    } else if (attempt.error) {
      throw new Error(attempt.error.message);
    }
  }

  // ---- Edit-in-place (draft only — no migration, pure app logic) -------
  // When edit_of is set we UPDATE the existing draft rather than inserting
  // a brand-new document. Number / status / created_by are preserved; the
  // lines + containers are replaced wholesale so the saved draft exactly
  // mirrors the builder state. Only a DRAFT may be edited in place — a
  // sent / won quotation is revised into a new version instead.
  if (input.edit_of) {
    const { data: src, error: srcErr } = await supabase
      .from("documents")
      .select("id, status, number")
      .eq("id", input.edit_of)
      .maybeSingle();
    if (srcErr) throw new Error(srcErr.message);
    if (!src) throw new Error("Quotation not found or not visible.");
    if (src.status !== "draft") {
      throw new Error(
        "Only draft quotations can be edited in place. Use “Create new version” to revise a sent or won quotation."
      );
    }

    // Mutable fields — everything except number / status / created_by.
    const baseUpdate: Record<string, unknown> = {
      client_id: input.client_id,
      type: input.type,
      incoterm: input.incoterm,
      freight_type: legacyFreightType,
      freight_cost: freight_total,
      manual_pricing: input.manual_pricing,
      total_price: grand_total,
      payment_mode: input.payment_mode,
      payment_terms: normalizedTerms,
      port_of_loading: input.port_of_loading,
      port_of_destination: input.port_of_destination,
      currency: input.currency,
      include_sales_conditions: input.include_sales_conditions,
      sales_conditions_id: input.include_sales_conditions
        ? input.sales_conditions_id
        : null,
      bank_account_id: input.bank_account_id,
      purchase_order_number: input.purchase_order_number,
      commission_enabled: input.commission_enabled,
      commission_percentage: input.commission_percentage,
      commission_amount,
      commission_description: input.commission_description,
      show_commission_in_pdf: input.show_commission_in_pdf,
      ...productionCols,
    };
    // Newer columns (m037 sales terms + m056 affair). Same retry-without
    // fallback used on the insert path so editing works pre-migration.
    const extendedUpdate: Record<string, unknown> = {
      warranty_years: input.warranty_years ?? null,
      offer_validity_products_days: input.offer_validity_products_days ?? 30,
      offer_validity_transport_days: input.offer_validity_transport_days ?? 7,
      affair_name: input.affair_name?.trim() || null,
      insurance_cost,
      additional_charges: clean_charges,
    };

    {
      const attempt = await supabase
        .from("documents")
        .update({ ...baseUpdate, ...extendedUpdate })
        .eq("id", input.edit_of);
      if (
        attempt.error &&
        /(warranty_years|offer_validity|affair_name|insurance_cost|additional_charges)/.test(
          attempt.error.message ?? ""
        )
      ) {
        const fb = await supabase
          .from("documents")
          .update(baseUpdate)
          .eq("id", input.edit_of);
        if (fb.error) throw new Error(fb.error.message);
      } else if (attempt.error) {
        throw new Error(attempt.error.message);
      }
    }

    // Replace child rows wholesale.
    {
      const { error: delLines } = await supabase
        .from("document_lines")
        .delete()
        .eq("document_id", input.edit_of);
      if (delLines) throw new Error(delLines.message);
      await insertLineRows(input.edit_of);
    }
    {
      const { error: delC } = await supabase
        .from("document_containers")
        .delete()
        .eq("document_id", input.edit_of);
      if (delC) throw new Error(delC.message);
      await insertContainers(input.edit_of);
    }

    await emitEvent({
      entity_type: "document",
      entity_id: input.edit_of,
      event_type: "doc.updated",
      message: `${
        input.type === "proforma" ? "Proforma" : "Quotation"
      } ${src.number ?? ""} edited — ${input.lines.length} line${
        input.lines.length === 1 ? "" : "s"
      }, ${input.currency} ${grand_total.toLocaleString()}`,
      payload: {
        number: src.number,
        type: input.type,
        currency: input.currency,
        lines_count: input.lines.length,
        grand_total,
        client_id: input.client_id,
      },
      bestEffort: true,
    });

    await maybeRequestValidation(
      supabase,
      input.edit_of,
      input,
      user.id,
      src.number
    );

    revalidatePath("/clients");
    revalidatePath("/dashboard");
    revalidatePath(`/documents/${input.edit_of}`);
    return { id: input.edit_of, number: src.number ?? null };
  }

  // Numbering — two paths:
  //   - Fresh quotation → per-client counter SLX-{code}-{YY}-{NNN}.
  //   - Revision (m059) → same base number as the source + "-V{n}",
  //     grouped under the same affair (root_document_id), version n.
  let numberRow: string | null = null;
  let reviseVersion = 1;
  let reviseRootId: string | null = null;
  if (input.revise_of) {
    // Source must be readable (RLS scopes to owner / technical roles).
    const { data: src, error: srcErr } = await supabase
      .from("documents")
      .select("id, number")
      .eq("id", input.revise_of)
      .maybeSingle();
    if (srcErr) throw new Error(srcErr.message);
    if (!src) throw new Error("Source quotation not found or not visible.");

    // Strip any existing "-V{n}" suffix to get the affair's base number.
    const baseNumber = String(src.number ?? "").replace(/-V\d+$/i, "");
    if (!baseNumber) {
      throw new Error("Source quotation has no number to base a version on.");
    }
    // Count existing versions of this affair purely from numbers, so it
    // works even before m059's version column is populated, and avoids
    // number collisions. next version = how many already exist + 1.
    const { data: siblings } = await supabase
      .from("documents")
      .select("id")
      .or(`number.eq.${baseNumber},number.ilike.${baseNumber}-V%`);
    reviseVersion = (siblings?.length ?? 1) + 1;
    numberRow = `${baseNumber}-V${reviseVersion}`;

    // Resolve the affair root. Prefer the source's root if it already
    // has one (m059); otherwise the source IS the root (V1). Done in a
    // defensive read so a missing column doesn't break the save.
    try {
      const { data: rootRow } = await supabase
        .from("documents")
        .select("root_document_id")
        .eq("id", input.revise_of)
        .maybeSingle();
      reviseRootId =
        (rootRow?.root_document_id as string | null) ?? input.revise_of;
    } catch {
      reviseRootId = input.revise_of;
    }
  } else {
    const { data, error: numErr } = await supabase.rpc(
      "next_client_document_number",
      { client_id_in: input.client_id }
    );
    if (numErr) throw new Error(numErr.message);
    numberRow = data as any;
  }

  // Base insert payload — fields that have always existed. The `number` is
  // injected per attempt by insertDocOnce (below) so the collision probe can
  // retry with a fresh candidate without rebuilding this whole object.
  const baseInsert: Record<string, unknown> = {
    client_id: input.client_id,
    type: input.type,
    status: "draft",
    incoterm: input.incoterm,
    freight_type: legacyFreightType,
    freight_cost: freight_total,
    manual_pricing: input.manual_pricing,
    total_price: grand_total,
    created_by: user.id,
    payment_mode: input.payment_mode,
    payment_terms: normalizedTerms,
    port_of_loading: input.port_of_loading,
    port_of_destination: input.port_of_destination,
    currency: input.currency,
    include_sales_conditions: input.include_sales_conditions,
    sales_conditions_id: input.include_sales_conditions
      ? input.sales_conditions_id
      : null,
    bank_account_id: input.bank_account_id,
    purchase_order_number: input.purchase_order_number,
    commission_enabled: input.commission_enabled,
    commission_percentage: input.commission_percentage,
    commission_amount,
    commission_description: input.commission_description,
    show_commission_in_pdf: input.show_commission_in_pdf,
    ...productionCols,
  };

  // Sales Terms additions (m037). We attempt the insert with them
  // included; if Postgres rejects because the columns don't exist
  // (m037 not applied to this env yet), we retry with the base shape
  // so the action still saves what it can.
  const salesTermsInsert: Record<string, unknown> = {
    warranty_years: input.warranty_years ?? null,
    offer_validity_products_days: input.offer_validity_products_days ?? 30,
    offer_validity_transport_days: input.offer_validity_transport_days ?? 7,
    // m056 — internal affair name. Lives in the same "newer columns"
    // bucket so it shares the retry-without fallback below.
    affair_name: input.affair_name?.trim() || null,
    // m076 — real project link (set when creating inside a project). On a
    // revision this stays null and the m076 trigger inherits the root's affair.
    affair_id: input.affair_id ?? null,
    // m134 — original sales request reminder (newer-columns bucket → shares the
    // retry-without fallback below if the column is missing on this env).
    original_sales_request: input.original_sales_request ?? null,
    // m059 — versioning. Only meaningful on a revision; a fresh quote
    // is version 1 with no root. The -V{n} suffix already lives in the
    // number, so even if these columns are missing the version is
    // still visible.
    version: input.revise_of ? reviseVersion : 1,
    root_document_id: input.revise_of ? reviseRootId : null,
    // m146 — logistics extras (shares the retry-without fallback below).
    insurance_cost,
    additional_charges: clean_charges,
  };

  // One insert attempt for a candidate number. Encapsulates the "newer
  // columns" retry (m037 sales terms / m056 affair_name / m076 affair_id /
  // m134 original_sales_request / m059 versioning / m146 logistics extras may
  // be unapplied on this env → strip them and retry) so the number-collision
  // probe below only has to reason about the number.
  const insertDocOnce = (candidate: string) => {
    const rich = { ...baseInsert, ...salesTermsInsert, number: candidate };
    return supabase
      .from("documents")
      .insert(rich)
      .select("id")
      .single()
      .then((attempt) => {
        if (
          attempt.error &&
          /(warranty_years|offer_validity|affair_name|affair_id|version|root_document_id|original_sales_request|insurance_cost|additional_charges)/.test(
            attempt.error.message ?? ""
          )
        ) {
          return supabase
            .from("documents")
            .insert({ ...baseInsert, number: candidate })
            .select("id")
            .single();
        }
        return attempt;
      });
  };

  // Insert with a GLOBALLY-unique number. next_client_document_number() runs
  // under the caller's RLS (SECURITY INVOKER) and only counts documents the rep
  // can see, so it undercounts when the client's number space already holds
  // rows created by another rep, or by another client sharing the same 3-letter
  // code. It then hands back an already-taken sequence and the insert trips the
  // global UNIQUE(number) constraint (documents_number_key) → previously a 500.
  //
  // The index is authoritative regardless of RLS, so treat the RPC value as a
  // starting guess and probe upward until the insert lands. A revision keeps
  // its derived "-V{n}" number and is never probed. Root-cause DB fix is
  // migration 147 (SECURITY DEFINER + prefix-scoped counter); this keeps saving
  // correct with or without it applied.
  let inserted: { id: string } | null = null;
  {
    let res = await insertDocOnce(numberRow!);
    const parsed = input.revise_of ? null : parseDocumentNumber(numberRow);
    if (res.error && parsed && isDocumentNumberCollision(res.error)) {
      // Jump past the highest sequence we CAN see (fast path for admins / own
      // docs), then linear-probe (covers RLS-hidden rows). The RPC value just
      // collided, so start strictly above it and never re-try it.
      let seq = parsed.seq + 1;
      try {
        const { data: seen } = await supabase
          .from("documents")
          .select("number")
          .like("number", `${parsed.prefix}%`);
        const hi = highestVisibleSeq(
          parsed.prefix,
          (seen ?? []).map((r) => (r as { number: string | null }).number)
        );
        if (hi != null && hi + 1 > seq) seq = hi + 1;
      } catch {
        /* best-effort jump only; the probe below guarantees correctness */
      }
      const MAX_PROBES = 200;
      let probes = 0;
      for (
        ;
        probes < MAX_PROBES && res.error && isDocumentNumberCollision(res.error);
        probes++
      ) {
        numberRow = formatDocumentNumber(parsed.prefix, seq++);
        res = await insertDocOnce(numberRow);
      }
      if (probes > 0) {
        // Diagnostic: the RPC undercounted (RLS-hidden rows / shared code).
        // The save still succeeded via the probe; apply m147 to fix at source.
        console.warn(
          `[saveDocument] next_client_document_number undercounted for prefix ${parsed.prefix}; ` +
            `probed ${probes} time(s), allocated ${numberRow}.`
        );
      }
    }
    if (res.error) throw new Error(res.error.message);
    inserted = res.data ?? null;
  }
  if (!inserted) throw new Error("Document insert returned no id");

  // Same row shape + m139-resilient insert as the edit-in-place path.
  await insertLineRows(inserted!.id);

  if (validContainers.length) {
    // Base row shape — fields that have always existed on
    // document_containers. Wooden box cost is an LCL-only field added
    // in migration 007 and surrounded by defensive handling below.
    const baseRows = validContainers.map((c, i) => ({
      document_id: inserted!.id,
      container_type: c.container_type,
      quantity: c.quantity,
      unit_price: c.unit_price,
      position: i,
    }));
    // Same rows + wooden_box_cost. Wooden box only makes sense for
    // LCL; we defensively zero it for FCL container types so the
    // value is always present (matches the column's NOT NULL DEFAULT 0).
    const richRows = validContainers.map((c, i) => ({
      ...baseRows[i],
      wooden_box_cost:
        c.container_type === "LCL" ? Number(c.wooden_box_cost || 0) : 0,
    }));

    // Try with wooden_box_cost. If PostgREST rejects because the
    // column is missing from its schema cache (m007 not yet applied
    // in this env, or stale cache after a Supabase restart), retry
    // with the base shape so the save still completes. The user can
    // then run `notify pgrst, 'reload schema'` to fix the cache.
    let cErr: { message: string } | null = null;
    {
      const attempt = await supabase
        .from("document_containers")
        .insert(richRows);
      if (
        attempt.error &&
        /wooden_box_cost/.test(attempt.error.message ?? "")
      ) {
        const fallback = await supabase
          .from("document_containers")
          .insert(baseRows);
        cErr = fallback.error;
      } else {
        cErr = attempt.error;
      }
    }
    if (cErr) throw new Error(cErr.message);
  }

  // Emit audit event AFTER lines + containers persisted so the timeline
  // shows the doc as complete. bestEffort: never block a save if the
  // events table is misconfigured.
  await emitEvent({
    entity_type: "document",
    entity_id: inserted!.id,
    event_type: "doc.created",
    message: `${input.type === "proforma" ? "Proforma" : "Quotation"} ${
      numberRow ?? ""
    } created — ${input.lines.length} line${
      input.lines.length === 1 ? "" : "s"
    }, ${input.currency} ${grand_total.toLocaleString()}`,
    payload: {
      number: numberRow,
      type: input.type,
      currency: input.currency,
      incoterm: input.incoterm,
      lines_count: input.lines.length,
      grand_total,
      client_id: input.client_id,
    },
    bestEffort: true,
  });

  await maybeRequestValidation(
    supabase,
    inserted!.id,
    input,
    user.id,
    numberRow
  );

  revalidatePath("/clients");
  revalidatePath("/dashboard");
  return { id: inserted!.id, number: numberRow };
}
