/**
 * Historical Invoice Import — server-side history loader.
 *
 * Reads the customer's IMPORTED documents (+ their product-linked lines) and
 * folds them into the pure `buildCustomerHistory` rollup. Only status
 * 'imported' rows count — staged/needs_attention/skipped never leak into stats.
 *
 * Isolation: this reads ONLY the import_* island. It never touches the live
 * commercial figures (/business, /forecast, revenue = won quotations).
 */

import { createClient } from "@/lib/supabase/server";
import {
  buildCustomerHistory,
  type CustomerHistory,
  type HistoryDoc,
  type HistoryLineRef,
} from "@/lib/import/history-stats";

export async function loadCustomerHistory(
  clientId: string
): Promise<CustomerHistory> {
  const supabase = createClient();

  const { data: docs, error } = await supabase
    .from("imported_documents")
    .select("id, number, doc_date, currency, total_amount")
    .eq("client_id", clientId)
    .eq("status", "imported")
    .order("doc_date", { ascending: true });

  // Table missing (migration not applied yet) → empty history, never crash.
  if (error) return buildCustomerHistory([], new Map());

  const docRows = (docs ?? []) as HistoryDoc[];
  if (docRows.length === 0) return buildCustomerHistory([], new Map());

  const ids = docRows.map((d) => d.id);
  const { data: lines } = await supabase
    .from("imported_document_lines")
    .select("imported_document_id, product_id, matched_product_name, quantity")
    .in("imported_document_id", ids);

  const byDoc = new Map<string, HistoryLineRef[]>();
  for (const l of lines ?? []) {
    const arr = byDoc.get(l.imported_document_id) ?? [];
    arr.push({
      product_id: l.product_id ?? null,
      matched_product_name: l.matched_product_name ?? null,
      quantity: l.quantity ?? null,
    });
    byDoc.set(l.imported_document_id, arr);
  }

  return buildCustomerHistory(docRows, byDoc);
}

/** Cheap count for the History tab badge / empty-state decision. */
export async function countImportedInvoices(clientId: string): Promise<number> {
  const supabase = createClient();
  const { count, error } = await supabase
    .from("imported_documents")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .eq("status", "imported");
  if (error) return 0;
  return count ?? 0;
}
