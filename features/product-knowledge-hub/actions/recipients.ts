"use server";

/**
 * Knowledge Hub — recipient picker for "Send to customer". Lists the clients the
 * rep can see (RLS on `clients` already scopes this to their own accounts +
 * anything management can see) with a best email + phone resolved from the
 * client's PRIMARY CONTACT (m101 address book), falling back to the embedded
 * client record. Gated by the same capability as the send itself.
 */

import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/permissions";

export type SendableClient = {
  id: string;
  company: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
};

function joinPhone(code: string | null, number: string | null): string | null {
  const c = (code ?? "").trim();
  const n = (number ?? "").trim();
  if (!n) return null;
  return c ? `${c} ${n}` : n;
}

export async function listSendableClients(): Promise<SendableClient[]> {
  await requireCapability("integration.send_business");
  const supabase = createClient();

  const { data: clients } = await supabase
    .from("clients")
    .select("id, company_name, email, phone_number, phone_country_code, contact_name")
    .is("archived_at", null)
    .order("company_name", { ascending: true })
    .limit(500);
  const rows = (clients ?? []) as any[];
  if (rows.length === 0) return [];

  // Primary contact per client (m101). Defensive: pre-migration this simply
  // returns nothing and we fall back to the embedded client fields.
  const ids = rows.map((c) => c.id);
  const { data: contactRows } = await supabase
    .from("contacts")
    .select("client_id, name, email, phone, is_primary, created_at")
    .in("client_id", ids)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true });
  const primaryByClient = new Map<string, any>();
  for (const r of (contactRows ?? []) as any[]) {
    if (!primaryByClient.has(r.client_id)) primaryByClient.set(r.client_id, r);
  }

  return rows.map((c) => {
    const pc = primaryByClient.get(c.id);
    const email = ((pc?.email ?? c.email) ?? "").toString().trim() || null;
    const phone = ((pc?.phone ?? joinPhone(c.phone_country_code, c.phone_number)) ?? "")
      .toString()
      .trim() || null;
    return {
      id: c.id as string,
      company: c.company_name as string,
      contactName: ((pc?.name ?? c.contact_name) ?? "").toString().trim() || null,
      email,
      phone,
    };
  });
}
