"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { emitEvent } from "@/lib/events";
import { requireCapability } from "@/lib/permissions";
import { normalizeBlProfile, blProfileStatus } from "@/lib/bl";
import { getCurrentUserRole, requireSuperAdmin } from "@/lib/auth";
import { canSupervise } from "@/lib/types";

/**
 * Reassign a client's SALES OWNER (account manager) — m066.
 *
 * Management-only (admin / super / TLM / operations), enforced on the REAL
 * role. An explicit owner overrides `created_by` everywhere the account
 * owner is shown/filtered; "__unassign__" clears it (falls back to the
 * creator). Defensive: a clear error if m066 isn't applied yet.
 */
export async function assignClientOwner(formData: FormData) {
  const id = String(formData.get("id"));
  if (!id) throw new Error("Missing client id");
  const raw = String(formData.get("owner_id") ?? "");
  const owner_id = raw && raw !== "__unassign__" ? raw : null;

  const { role } = await getCurrentUserRole();
  if (!canSupervise(role)) {
    throw new Error("Only management roles can reassign account ownership.");
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("clients")
    .update({ sales_owner_id: owner_id })
    .eq("id", id);
  if (error) {
    if (/sales_owner_id/.test(error.message ?? "")) {
      throw new Error(
        "sales_owner_id column missing — apply migration m066 (066_sales_owner_assignment.sql)."
      );
    }
    throw new Error(error.message);
  }

  revalidatePath("/clients");
  revalidatePath(`/clients/${id}/edit`);
}

/**
 * Quotation duplication. Moved here from the now-deleted `/quotations`
 * route so the clients workspace (the new sales hub) can call it directly
 * from the expandable client rows. Same logic as before — clones the
 * source doc + its lines + containers under a new client-scoped number,
 * status reset to "draft".
 */
export async function duplicateDocument(formData: FormData) {
  // PERM-1 — duplicating is a second create path; gate it like saveDocument.
  await requireCapability("quotation.create");
  const id = String(formData.get("id"));
  const supabase = createClient();

  const { data: src, error } = await supabase
    .from("documents")
    .select("*, document_lines(*), document_containers(*)")
    .eq("id", id)
    .single();
  if (error || !src) throw new Error(error?.message ?? "Document not found");

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Per-client numbering (SLX-CODE-YY-NNN). Falls back to the generic
  // generator if the source doc has no linked client.
  let numberRow: string | null = null;
  if (src.client_id) {
    const { data, error: nErr } = await supabase.rpc(
      "next_client_document_number",
      { client_id_in: src.client_id }
    );
    if (nErr) throw new Error(nErr.message);
    numberRow = data as any;
  } else {
    const { data } = await supabase.rpc("next_document_number", {
      doc_type: src.type,
    });
    numberRow = data as any;
  }

  const { data: inserted, error: insErr } = await supabase
    .from("documents")
    .insert({
      number: numberRow,
      client_id: src.client_id,
      // P2a: a duplicate is a new round of the SAME opportunity → same affair.
      affair_id: src.affair_id,
      type: src.type,
      status: "draft",
      incoterm: src.incoterm,
      freight_type: src.freight_type,
      freight_cost: src.freight_cost,
      manual_pricing: src.manual_pricing,
      total_price: src.total_price,
      created_by: user?.id,
      payment_mode: src.payment_mode,
      payment_terms: src.payment_terms,
      port_of_loading: src.port_of_loading,
      port_of_destination: src.port_of_destination,
      production_mode: src.production_mode,
      production_days: src.production_days,
      production_date: src.production_date,
      currency: src.currency,
      include_sales_conditions: src.include_sales_conditions,
      sales_conditions_id: src.sales_conditions_id,
      bank_account_id: src.bank_account_id,
      purchase_order_number: src.purchase_order_number,
      commission_enabled: src.commission_enabled,
      commission_percentage: src.commission_percentage,
      commission_amount: src.commission_amount,
      commission_description: src.commission_description,
      show_commission_in_pdf: src.show_commission_in_pdf,
    })
    .select("id")
    .single();
  if (insErr) throw new Error(insErr.message);

  const lines = (src.document_lines ?? []).map((l: any) => ({
    document_id: inserted!.id,
    product_id: l.product_id,
    category_id: l.category_id ?? null, // m133 — keep the family across the copy
    quantity: l.quantity,
    selected_options: l.selected_options,
    unit_price: l.unit_price,
    total_price: l.total_price,
    pricing_mode: l.pricing_mode,
    pricing_tier: l.pricing_tier,
    original_unit_price: l.original_unit_price,
    discount_type: l.discount_type,
    discount_value: l.discount_value,
    client_product_name: l.client_product_name,
    config_values: l.config_values ?? {},
  }));
  if (lines.length) {
    const { error: linesErr } = await supabase
      .from("document_lines")
      .insert(lines);
    if (linesErr) throw new Error(linesErr.message);
  }

  const containers = (src.document_containers ?? []).map(
    (c: any, i: number) => ({
      document_id: inserted!.id,
      container_type: c.container_type,
      quantity: c.quantity,
      unit_price: c.unit_price,
      wooden_box_cost: c.wooden_box_cost ?? 0,
      position: c.position ?? i,
    })
  );
  if (containers.length) {
    const { error: cErr } = await supabase
      .from("document_containers")
      .insert(containers);
    if (cErr) throw new Error(cErr.message);
  }

  // PERM-1 — audit the duplicate like a normal creation (doc.created parity).
  await emitEvent({
    entity_type: "document",
    entity_id: inserted!.id,
    event_type: "doc.created",
    message: `${src.type === "proforma" ? "Proforma" : "Quotation"} ${
      numberRow ?? ""
    } created (duplicated from ${src.number ?? id.slice(0, 8) + "…"})`,
    payload: {
      number: numberRow,
      type: src.type,
      currency: src.currency,
      client_id: src.client_id,
      lines_count: lines.length,
      duplicated_from: id,
      duplicated_from_number: src.number ?? null,
    },
    bestEffort: true,
  });

  // Refresh every surface that lists documents.
  revalidatePath("/clients");
  revalidatePath("/dashboard");
  redirect(`/documents/${inserted!.id}`);
}

function str(fd: FormData, key: string) {
  const v = fd.get(key);
  return v == null ? null : String(v).trim() || null;
}

function num(fd: FormData, key: string, fallback = 0) {
  const v = fd.get(key);
  if (v == null || String(v).trim() === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function clientCode(fd: FormData): string | null {
  const raw = str(fd, "client_code");
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (!/^[A-Z]{3}$/.test(upper)) {
    throw new Error("Client code must be exactly 3 letters (e.g. ARL)");
  }
  return upper;
}

// custom_fields[][label] / custom_fields[][value] from form data → JSONB array.
function customFields(fd: FormData) {
  const labels = fd.getAll("custom_field_label").map((v) => String(v).trim());
  const values = fd.getAll("custom_field_value").map((v) => String(v).trim());
  const out: { label: string; value: string }[] = [];
  for (let i = 0; i < Math.max(labels.length, values.length); i++) {
    const label = labels[i] ?? "";
    const value = values[i] ?? "";
    if (!label && !value) continue; // drop fully empty rows
    if (!label) {
      throw new Error(`Custom field row ${i + 1}: label is required`);
    }
    out.push({ label, value });
  }
  return out;
}

export async function createClientAction(formData: FormData) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Base columns — always present.
  const basePayload = {
    company_name: str(formData, "company_name"),
    contact_name: str(formData, "contact_name"),
    email: str(formData, "email"),
    phone_number: str(formData, "phone_number"),
    country: str(formData, "country"),
    client_code: clientCode(formData),
    starting_sequence_number: num(formData, "starting_sequence_number", 0),
    custom_fields: customFields(formData),
  };
  // Validation errors are RETURNED (not thrown) so the modal can show them
  // inline and keep everything the user typed — throwing bubbles to the
  // generic "We couldn't complete that action" boundary and discards the form.
  if (!basePayload.company_name) return { error: "Company name is required." };
  // A client without a 3-letter code silently breaks every quotation save
  // later (buildPayload in the document form rejects it). Enforce it here at
  // creation — the single source of truth — so the broken state can never be
  // created. The inline new-client flow on the quotation form already
  // requires it; this brings the dedicated form in line. (clientCode() above
  // validates the 3-letter format; this guards the empty case with a clear,
  // actionable message.)
  if (!basePayload.client_code) {
    return {
      error:
        "A 3-letter client code is required (e.g. ARL). It is used in every quotation, proforma and production-order number — a client without it can't have documents saved.",
    };
  }

  // Newer columns (m036 export fields + m051 phone code + m058 owner).
  // We attempt the insert with them included; if the DB rejects because
  // a column is missing (partial migration history), retry with the
  // base shape so the client still gets created with what we can store.
  // `created_by` is REQUIRED by the m058 RLS insert policy — once that
  // migration is applied, every new client gets an owner.
  const extraPayload = {
    address: str(formData, "address"),
    vat_number: str(formData, "vat_number"),
    default_attention_to: str(formData, "default_attention_to"),
    phone_country_code: str(formData, "phone_country_code"),
    created_by: user?.id ?? null,
  };
  const payload = { ...basePayload, ...extraPayload };

  // Insert + return the new row so we can emit an event with the real id.
  let { data: inserted, error } = await supabase
    .from("clients")
    .insert(payload)
    .select("id, company_name, client_code")
    .single();
  if (
    error &&
    /(address|vat_number|default_attention_to|phone_country_code|created_by)/.test(
      error.message ?? ""
    )
  ) {
    ({ data: inserted, error } = await supabase
      .from("clients")
      .insert(basePayload)
      .select("id, company_name, client_code")
      .single());
  }
  if (error) {
    // Surface a friendly, inline error instead of crashing the page. The most
    // common case by far is a duplicate 3-letter code (the space is tiny) —
    // catch the unique-violation explicitly so the user can just pick another.
    const msg = error.message ?? "";
    if ((error as { code?: string }).code === "23505" || /client_code|unique/i.test(msg)) {
      return {
        error: `Client code "${basePayload.client_code}" is already used by another client. Please choose a different 3-letter code.`,
      };
    }
    return { error: msg || "Could not create the client. Please try again." };
  }

  if (inserted?.id) {
    await emitEvent({
      entity_type: "client",
      entity_id: inserted.id,
      event_type: "client.created",
      message: `Client created: ${inserted.company_name}${
        inserted.client_code ? ` (${inserted.client_code})` : ""
      }`,
      payload: {
        company_name: inserted.company_name,
        client_code: inserted.client_code,
        country: payload.country,
      },
      bestEffort: true,
    });
  }

  revalidatePath("/clients");
  // F6 fix — redirect SERVER-SIDE (deterministic, handled at the server-action
  // boundary by Next) to the created client, carrying a one-shot ?flash success
  // toast. The previous pattern returned the id and let the modal's CLIENT-side
  // router.push() navigate, which did NOT fire reliably (no redirect, no toast,
  // user stranded on /clients). redirect() throws NEXT_REDIRECT and never returns.
  redirect(
    inserted?.id
      ? `/clients/${inserted.id}?flash=${encodeURIComponent("✓ Client created")}`
      : `/clients?flash=${encodeURIComponent("✓ Client created")}`,
  );
}

/**
 * Save a client's Shipping / BL profile (m054). The editor serializes
 * the whole nested profile (shipper / consignee / notify / documents /
 * notes) into a single JSON field, which we validate + persist into the
 * `bl_profile` jsonb column.
 *
 * Soft-guides if m054 isn't applied. RLS on `clients` (m046) already
 * scopes who can write — owner or admin/TLM/operations/super.
 */
export async function updateClientBlProfile(formData: FormData) {
  const id = String(formData.get("id"));
  if (!id) throw new Error("Missing client id");

  const raw = String(formData.get("bl_profile") ?? "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || "{}");
  } catch {
    throw new Error("Invalid BL profile payload (must be JSON).");
  }
  // Normalize server-side so we always store a complete, well-shaped
  // blob regardless of what the client sent.
  const profile = normalizeBlProfile(parsed);

  const supabase = createClient();
  const { error } = await supabase
    .from("clients")
    .update({ bl_profile: profile })
    .eq("id", id);
  if (error) {
    if (/bl_profile/.test(error.message ?? "")) {
      throw new Error(
        "bl_profile column missing — apply migration m054 (054_client_bl_profile.sql) in Supabase."
      );
    }
    throw new Error(error.message);
  }

  await emitEvent({
    entity_type: "client",
    entity_id: id,
    event_type: "client.updated",
    message: "Shipping / BL profile updated",
    payload: { section: "bl_profile" },
    bestEffort: true,
  });

  // --- BL request resolution loop (Operations ↔ Sales) -------------------
  // If the profile is NOW complete, close every pending "Operations
  // requested BL info" request on this client's orders:
  //   1. emit po.bl_info_resolved on each order (timeline: "blocker
  //      lifted") — this is also what re-arms the anti-duplicate gate in
  //      requestBlInfoFromSales;
  //   2. auto-complete the "Complete Shipping / BL Profile" planned
  //      action the request created (the sales to-do resolves on FACTS —
  //      required fields filled — not on a manual dismiss).
  // Best-effort by design: a failure here must never block saving the
  // profile itself.
  try {
    if (blProfileStatus(profile) === "complete") {
      const { data: reqEvents } = await supabase
        .from("events")
        .select("entity_id, created_at, payload")
        .eq("event_type", "po.bl_info_requested")
        .contains("payload", { client_id: id })
        .order("created_at", { ascending: false })
        .limit(25);
      const seenOrders = new Set<string>();
      for (const ev of (reqEvents ?? []) as any[]) {
        const orderId = ev.entity_id as string;
        if (seenOrders.has(orderId)) continue;
        seenOrders.add(orderId);
        // Pending = no resolution newer than the latest request.
        const { data: lastRes } = await supabase
          .from("events")
          .select("created_at")
          .eq("entity_type", "production_order")
          .eq("entity_id", orderId)
          .eq("event_type", "po.bl_info_resolved")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (lastRes && Date.parse(lastRes.created_at) >= Date.parse(ev.created_at)) {
          continue; // already resolved
        }
        await emitEvent({
          entity_type: "production_order",
          entity_id: orderId,
          event_type: "po.bl_info_resolved",
          message:
            "Sales completed the Shipping / BL profile — shipment booking blocker resolved.",
          payload: { client_id: id, section: "bl_profile" },
          bestEffort: true,
        });
        // Tick the sales to-do created by the request (m103). Matched on
        // the exact title the request used; only open actions are closed.
        const affairId = (ev.payload?.affair_id as string | null) ?? null;
        if (affairId) {
          await supabase
            .from("planned_actions")
            .update({ done_at: new Date().toISOString() })
            .eq("affair_id", affairId)
            .eq("title", "Complete Shipping / BL Profile")
            .is("done_at", null);
        }
        revalidatePath(`/production/orders/${orderId}`);
      }
      if (seenOrders.size > 0) revalidatePath("/dashboard");
    }
  } catch {
    /* resolution is best-effort — saving the profile already succeeded */
  }

  revalidatePath(`/clients/${id}`);
  revalidatePath(`/clients/${id}/edit`);
}

export async function updateClientAction(formData: FormData) {
  const id = String(formData.get("id"));
  if (!id) throw new Error("Missing client id");

  const supabase = createClient();

  // Read the pre-update row so we can build a meaningful diff for the
  // event payload. If the read fails we still proceed with the update —
  // the audit log is best-effort.
  const { data: before } = await supabase
    .from("clients")
    .select(
      "company_name, contact_name, email, phone_number, country, client_code, starting_sequence_number"
    )
    .eq("id", id)
    .maybeSingle();

  // Base payload — the columns that have always been there.
  const basePayload = {
    company_name: str(formData, "company_name"),
    contact_name: str(formData, "contact_name"),
    email: str(formData, "email"),
    phone_number: str(formData, "phone_number"),
    country: str(formData, "country"),
    client_code: clientCode(formData),
    starting_sequence_number: num(formData, "starting_sequence_number", 0),
    custom_fields: customFields(formData),
  };

  // New PDF-related fields (migration 036). We attempt the update with
  // them included; if the DB rejects because the columns don't exist
  // yet, we retry with the legacy shape so the action still saves what
  // it can.
  const pdfPayload = {
    address: str(formData, "address") || null,
    vat_number: str(formData, "vat_number") || null,
    default_attention_to: str(formData, "default_attention_to") || null,
    phone_country_code: str(formData, "phone_country_code") || null,
  };

  let updateResult = await supabase
    .from("clients")
    .update({ ...basePayload, ...pdfPayload })
    .eq("id", id);
  if (
    updateResult.error &&
    /(address|vat_number|default_attention_to|phone_country_code)/.test(
      updateResult.error.message ?? ""
    )
  ) {
    updateResult = await supabase
      .from("clients")
      .update(basePayload)
      .eq("id", id);
  }
  const { error } = updateResult;
  if (error) throw new Error(error.message);

  // For the audit diff below we want the next-state shape including the
  // new fields, since the user may legitimately have edited them.
  const next = { ...basePayload, ...pdfPayload };

  // Compute a short list of changed top-level fields (excluding
  // custom_fields, which would be too noisy to diff here).
  const changed: string[] = [];
  if (before) {
    for (const k of [
      "company_name",
      "contact_name",
      "email",
      "phone_number",
      "country",
      "client_code",
      "starting_sequence_number",
    ] as const) {
      if ((before as any)[k] !== (next as any)[k]) changed.push(k);
    }
  }

  await emitEvent({
    entity_type: "client",
    entity_id: id,
    event_type: "client.updated",
    message:
      changed.length > 0
        ? `Updated ${changed.join(", ")} on ${next.company_name}`
        : `Updated ${next.company_name}`,
    payload: { changed_fields: changed, company_name: next.company_name },
    bestEffort: true,
  });

  revalidatePath("/clients");
  redirect("/clients");
}

/**
 * Hard-delete a client.
 *
 * Uses the `delete_client_safe` RPC (migration 032) which:
 *  - runs the dependency count with SECURITY DEFINER (bypasses RLS so
 *    Sales reps can't accidentally skip past invisible deps from other
 *    reps' quotations on the same client),
 *  - refuses with a precise message if anything is linked,
 *  - performs the DELETE in the same transaction if nothing is.
 *
 * Earlier versions did the count on the client side and hit two
 * problems: RLS hid rows from Sales, AND a TOCTOU window existed
 * between count and delete. The RPC closes both.
 *
 * We snapshot the row BEFORE calling the RPC so the audit event can
 * carry the company_name — UUIDs alone are useless in a 6-month-old
 * timeline.
 */
export async function deleteClientAction(formData: FormData) {
  const id = String(formData.get("id"));
  if (!id) throw new Error("Missing client id");

  const supabase = createClient();

  // Snapshot for the audit event before the destructive op.
  const { data: snapshot } = await supabase
    .from("clients")
    .select("company_name, client_code, country")
    .eq("id", id)
    .maybeSingle();

  const { error: rpcErr } = await supabase.rpc("delete_client_safe", {
    target_client_id: id,
  });
  if (rpcErr) {
    // The RPC raises with a precise message when the client has
    // dependencies. Surface that to the UI verbatim; the message
    // already includes the "Use Archive client instead" hint.
    //
    // Fallback when the RPC isn't deployed yet (migration 032 not
    // applied): tell the user explicitly so they don't chase the
    // wrong bug.
    if (rpcErr.code === "42883" /* function does not exist */) {
      throw new Error(
        "delete_client_safe RPC is not deployed yet. Apply migration " +
          "032_client_delete_rpc.sql in Supabase and try again."
      );
    }
    throw new Error(rpcErr.message);
  }

  await emitEvent({
    entity_type: "client",
    entity_id: id,
    event_type: "client.deleted",
    message: `Client deleted: ${snapshot?.company_name ?? "(unknown)"}${
      snapshot?.client_code ? ` (${snapshot.client_code})` : ""
    }`,
    payload: {
      company_name: snapshot?.company_name,
      client_code: snapshot?.client_code,
      country: snapshot?.country,
    },
    bestEffort: true,
  });

  revalidatePath("/clients");
  redirect("/clients");
}

/**
 * Permanent (physical) delete of a client — SUPER-ADMIN ONLY (m128).
 *
 * Backed by admin_delete_client() (SECURITY DEFINER): re-checks super-admin,
 * REFUSES if the client has any quotation / task list / production order
 * (archive instead — history is preserved), else cascades the safe children
 * (affairs, project requests + children, planned actions, contacts) and
 * deletes the client, atomically.
 */
export async function deleteClientPermanently(formData: FormData) {
  await requireSuperAdmin();
  const id = String(formData.get("id"));
  if (!id) throw new Error("Missing client id");
  const supabase = createClient();
  const { data: snapshot } = await supabase
    .from("clients")
    .select("company_name, client_code")
    .eq("id", id)
    .maybeSingle();
  const { error } = await supabase.rpc("admin_delete_client", { p_client: id });
  if (error) {
    if (error.code === "42883") {
      throw new Error(
        "admin_delete_client RPC not deployed yet — apply migration 128_admin_delete_client.sql in Supabase."
      );
    }
    throw new Error(error.message);
  }
  await emitEvent({
    entity_type: "client",
    entity_id: id,
    event_type: "client.deleted",
    message: `Client permanently deleted: ${snapshot?.company_name ?? "(unknown)"}${
      snapshot?.client_code ? ` (${snapshot.client_code})` : ""
    }`,
    bestEffort: true,
  });
  revalidatePath("/clients");
  redirect("/clients");
}

/**
 * Soft-archive a client.
 *
 * Sets `archived_at = now()` so the client disappears from active
 * lists but every linked document / task list / production order
 * stays intact and addressable. Designed as the safe fallback when
 * deleteClientAction refuses because of linked entities.
 */
export async function archiveClientAction(formData: FormData) {
  const id = String(formData.get("id"));
  if (!id) throw new Error("Missing client id");

  const supabase = createClient();

  const { data: snapshot } = await supabase
    .from("clients")
    .select("company_name, client_code")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase
    .from("clients")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);

  await emitEvent({
    entity_type: "client",
    entity_id: id,
    event_type: "client.updated",
    message: `Client archived: ${snapshot?.company_name ?? "(unknown)"}`,
    payload: {
      company_name: snapshot?.company_name,
      client_code: snapshot?.client_code,
      action: "archive",
    },
    bestEffort: true,
  });

  revalidatePath("/clients");
  revalidatePath(`/clients/${id}`);
}

/**
 * Restore a previously archived client. Reverse of archiveClientAction.
 */
export async function unarchiveClientAction(formData: FormData) {
  const id = String(formData.get("id"));
  if (!id) throw new Error("Missing client id");

  const supabase = createClient();

  const { data: snapshot } = await supabase
    .from("clients")
    .select("company_name, client_code")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase
    .from("clients")
    .update({ archived_at: null })
    .eq("id", id);
  if (error) throw new Error(error.message);

  await emitEvent({
    entity_type: "client",
    entity_id: id,
    event_type: "client.updated",
    message: `Client restored from archive: ${snapshot?.company_name ?? "(unknown)"}`,
    payload: {
      company_name: snapshot?.company_name,
      client_code: snapshot?.client_code,
      action: "unarchive",
    },
    bestEffort: true,
  });

  revalidatePath("/clients");
  revalidatePath(`/clients/${id}`);
}

// =====================================================================
// CRM step 2 (m101) — contacts: multiple contact persons per client.
// The embedded clients.contact_name/email/phone_number stay untouched
// (they remain the company contact printed on documents); these actions
// manage the address book. RLS gates writes (client owner/creator or
// management).
// =====================================================================

function contactFields(formData: FormData) {
  const s = (k: string) => {
    const v = formData.get(k);
    return v == null ? null : String(v).trim() || null;
  };
  return {
    name: String(formData.get("name") ?? "").trim(),
    title: s("title"),
    email: s("email"),
    phone: s("phone"),
    notes: s("notes"),
    is_primary: formData.get("is_primary") === "on",
  };
}

export async function createContactAction(formData: FormData) {
  const clientId = String(formData.get("client_id") ?? "");
  if (!clientId) throw new Error("Missing client id");
  const f = contactFields(formData);
  if (!f.name) throw new Error("Contact name is required");

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Only one primary per client — demote others first.
  if (f.is_primary) {
    await supabase.from("contacts").update({ is_primary: false }).eq("client_id", clientId);
  }
  const { error } = await supabase.from("contacts").insert({
    client_id: clientId,
    ...f,
    created_by: user?.id ?? null,
  });
  if (error) throw new Error(error.message);

  await emitEvent({
    entity_type: "client",
    entity_id: clientId,
    event_type: "client.contact_added",
    message: `Contact added: ${f.name}`,
    payload: { name: f.name, title: f.title },
    bestEffort: true,
  });
  revalidatePath(`/clients/${clientId}`);
}

export async function updateContactAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const clientId = String(formData.get("client_id") ?? "");
  if (!id || !clientId) throw new Error("Missing contact id");
  const f = contactFields(formData);
  if (!f.name) throw new Error("Contact name is required");

  const supabase = createClient();
  if (f.is_primary) {
    await supabase.from("contacts").update({ is_primary: false }).eq("client_id", clientId);
  }
  const { error } = await supabase
    .from("contacts")
    .update({ ...f, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);

  await emitEvent({
    entity_type: "client",
    entity_id: clientId,
    event_type: "client.contact_updated",
    message: `Contact updated: ${f.name}`,
    payload: { name: f.name, title: f.title },
    bestEffort: true,
  });
  revalidatePath(`/clients/${clientId}`);
}

export async function deleteContactAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const clientId = String(formData.get("client_id") ?? "");
  if (!id || !clientId) throw new Error("Missing contact id");

  const supabase = createClient();
  const { data: snapshot } = await supabase
    .from("contacts")
    .select("name")
    .eq("id", id)
    .maybeSingle();
  const { error } = await supabase.from("contacts").delete().eq("id", id);
  if (error) throw new Error(error.message);

  await emitEvent({
    entity_type: "client",
    entity_id: clientId,
    event_type: "client.contact_deleted",
    message: `Contact removed: ${snapshot?.name ?? "(unknown)"}`,
    bestEffort: true,
  });
  revalidatePath(`/clients/${clientId}`);
}
