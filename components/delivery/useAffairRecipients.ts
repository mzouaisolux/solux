"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type Recipient = {
  id: string;
  name: string | null;
  email: string | null;
  is_primary: boolean | null;
};

/**
 * Single recipient-resolution path for the Document Delivery System — unifies
 * the two flows the old buttons had. Prefers a known `clientId` (quotation
 * page passes it); otherwise derives it from `affairId` (affair document rows).
 * Returns the client's contacts that have an email (primary first) + the
 * affair name (when derived from the affair). Falls back to a typed recipient.
 */
export function useAffairRecipients(opts: {
  affairId?: string | null;
  clientId?: string | null;
}) {
  const { affairId, clientId } = opts;
  const [affairName, setAffairName] = useState<string | null>(null);
  const [contacts, setContacts] = useState<Recipient[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        let cid = clientId ?? null;
        if (!cid && affairId) {
          const { data: aff } = await supabase
            .from("affairs")
            .select("name, client_id")
            .eq("id", affairId)
            .maybeSingle();
          if (cancelled) return;
          if (aff) {
            setAffairName((aff as any).name ?? null);
            cid = ((aff as any).client_id as string | null) ?? null;
          }
        }
        if (!cid) return;
        const { data: rows } = await supabase
          .from("contacts")
          .select("id, name, email, is_primary")
          .eq("client_id", cid)
          .order("is_primary", { ascending: false });
        if (cancelled || !rows) return;
        setContacts((rows as Recipient[]).filter((c) => c.email));
      } catch {
        /* recipient will be typed manually */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [affairId, clientId]);

  return { affairName, contacts, primaryEmail: contacts[0]?.email ?? null };
}
