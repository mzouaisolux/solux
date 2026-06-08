"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { emitEvent } from "@/lib/events";
import { requireCapability } from "@/lib/permissions";

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

  const { data: { user } } = await supabase.auth.getUser();

  // Per-client numbering (SLX-CODE-YY-NNN). Falls back to old generator if
  // the document somehow lacks a client.
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
  }));
  if (lines.length) {
    const { error: linesErr } = await supabase.from("document_lines").insert(lines);
    if (linesErr) throw new Error(linesErr.message);
  }

  const containers = (src.document_containers ?? []).map((c: any, i: number) => ({
    document_id: inserted!.id,
    container_type: c.container_type,
    quantity: c.quantity,
    unit_price: c.unit_price,
    wooden_box_cost: c.wooden_box_cost ?? 0,
    position: c.position ?? i,
  }));
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

  revalidatePath("/dashboard");
  redirect(`/documents/${inserted!.id}`);
}
