// =====================================================================
// READ-ONLY analysis — "Orders in flight" board source comparison.
//
// Answers, on REAL data, the Operations V2 Phase 2 question: should the board
// be sourced from "won quotation + task list" (current) or "active production
// orders" (proposed)? Joins the relevant tables in JS (q.ts can't), classifies
// every active PO by why it is / isn't in the current board, and prints counts
// + concrete examples. NO writes. Run as a role to respect that role's RLS.
//
//   node --env-file=.env.local --env-file=.env.e2e --experimental-strip-types \
//     e2e/audit/analyze-board-source.ts [role=admin]
// =====================================================================
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!.trim();
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim();
const PW = process.env.E2E_PASSWORD!;
const role = (process.argv[2] || "admin").toLowerCase();

const PO_TERMINAL = new Set(["delivered", "cancelled"]);

async function main() {
  const email = process.env[`E2E_${role.toUpperCase()}_EMAIL`]!;
  const sb = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error: e } = await sb.auth.signInWithPassword({ email, password: PW });
  if (e) { console.error(`login ${role} failed: ${e.message}`); process.exit(1); }

  const now = new Date();
  const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);

  const [docsR, posR, tlsR, clientsR] = await Promise.all([
    sb.from("documents").select(
      "id, type, status, date, archived_at, number, affair_id, affair_name, client_id, total_price"
    ).limit(2000),
    sb.from("production_orders").select(
      "id, quotation_id, affair_id, status, archived_at, number, shipment_booked, current_production_deadline, updated_at"
    ).limit(2000),
    sb.from("production_task_lists").select(
      "id, quotation_id, status, archived_at, number"
    ).limit(2000),
    sb.from("clients").select("id, company_name, client_code").limit(2000),
  ]);

  for (const [name, r] of [["documents", docsR], ["production_orders", posR], ["production_task_lists", tlsR], ["clients", clientsR]] as const) {
    if (r.error) { console.log(`ERROR reading ${name}: ${r.error.code} ${r.error.message}`); process.exit(1); }
  }

  const docs = docsR.data ?? [];
  const pos = posR.data ?? [];
  const tls = tlsR.data ?? [];
  const clients = clientsR.data ?? [];

  const docById = new Map(docs.map((d: any) => [d.id, d]));
  const clientById = new Map(clients.map((c: any) => [c.id, c]));
  const cname = (id: string | null) => (id && clientById.get(id)?.company_name) || "—";

  // task lists keyed by their quotation_id
  const tlByQuoteId = new Map<string, any[]>();
  for (const t of tls) {
    const k = t.quotation_id;
    if (!k) continue;
    if (!tlByQuoteId.has(k)) tlByQuoteId.set(k, []);
    tlByQuoteId.get(k)!.push(t);
  }

  console.log(`\n=== ROLE ${role} · totals visible under RLS ===`);
  console.log(`documents=${docs.length}  production_orders=${pos.length}  task_lists=${tls.length}  clients=${clients.length}`);
  const docTypes: Record<string, number> = {};
  for (const d of docs) docTypes[d.type] = (docTypes[d.type] ?? 0) + 1;
  console.log(`document types: ${JSON.stringify(docTypes)}`);

  // ---- What do task lists key on? quotation vs proforma vs other ----
  const tlKeyType: Record<string, number> = {};
  for (const t of tls) {
    const d = docById.get(t.quotation_id);
    const k = d ? d.type : "MISSING_DOC";
    tlKeyType[k] = (tlKeyType[k] ?? 0) + 1;
  }
  console.log(`\n=== task_lists.quotation_id resolves to document.type ===`);
  console.log(JSON.stringify(tlKeyType));

  // ---- What do production_orders key on? ----
  const poKeyType: Record<string, number> = {};
  for (const p of pos) {
    const d = docById.get(p.quotation_id);
    const k = d ? d.type : (p.quotation_id ? "MISSING_DOC" : "NULL_QUOTE");
    poKeyType[k] = (poKeyType[k] ?? 0) + 1;
  }
  console.log(`\n=== production_orders.quotation_id resolves to document.type ===`);
  console.log(JSON.stringify(poKeyType));

  // ============================================================
  // SOURCE A — current board: won quotation (type=quotation, status=won,
  // !archived, date>=12mo) that HAS a task list.
  // ============================================================
  const wonQuotes = docs.filter((d: any) =>
    d.type === "quotation" && d.status === "won" && !d.archived_at && new Date(d.date) >= twelveMonthsAgo
  );
  const sourceA = wonQuotes.filter((d: any) => tlByQuoteId.has(d.id));
  console.log(`\n=========================================================`);
  console.log(`SOURCE A (current board) = won quotation + task list (12mo)`);
  console.log(`  won quotations (12mo, live): ${wonQuotes.length}`);
  console.log(`  …of which have a task list : ${sourceA.length}   <-- board count today`);
  console.log(`  examples:`);
  for (const d of sourceA.slice(0, 12)) {
    console.log(`   • ${d.number}  ${cname(d.client_id)}  affair=${d.affair_name ?? "—"}`);
  }

  // ============================================================
  // SOURCE B — proposed: active production_orders (!archived, status not
  // in cancelled/delivered).
  // ============================================================
  const activePOs = pos.filter((p: any) => !p.archived_at && !PO_TERMINAL.has(p.status));
  console.log(`\n=========================================================`);
  console.log(`SOURCE B (proposed) = active production_orders`);
  console.log(`  total production_orders     : ${pos.length}`);
  console.log(`  …active (not delivered/canc): ${activePOs.length}   <-- board count if we switch`);
  const statusCount: Record<string, number> = {};
  for (const p of activePOs) statusCount[p.status] = (statusCount[p.status] ?? 0) + 1;
  console.log(`  active PO status breakdown  : ${JSON.stringify(statusCount)}`);
  console.log(`  examples:`);
  for (const p of activePOs.slice(0, 20)) {
    const d = docById.get(p.quotation_id);
    console.log(`   • ${p.number}  status=${p.status}  doc=${d ? `${d.type}/${d.status}` : "??"}  client=${cname(d?.client_id)}  affair=${d?.affair_name ?? p.affair_id ?? "—"}`);
  }

  // ============================================================
  // GAP — active POs NOT covered by SOURCE A, with the reason.
  // ============================================================
  const sourceADocIds = new Set(sourceA.map((d: any) => d.id));
  console.log(`\n=========================================================`);
  console.log(`GAP — active POs missing from current board (and why)`);
  const reasons: Record<string, number> = {};
  for (const p of activePOs) {
    const d = docById.get(p.quotation_id);
    let reason: string;
    if (!d) reason = p.quotation_id ? "PO doc not visible/missing" : "PO has null quotation_id";
    else if (sourceADocIds.has(d.id)) reason = "ALREADY in board (overlap)";
    else if (d.type !== "quotation") reason = `doc is ${d.type} (not quotation)`;
    else if (d.status !== "won") reason = `quotation status=${d.status} (not won)`;
    else if (new Date(d.date) < twelveMonthsAgo) reason = "quotation older than 12 months";
    else if (!tlByQuoteId.has(d.id)) reason = "won quotation but NO task list";
    else reason = "other";
    reasons[reason] = (reasons[reason] ?? 0) + 1;
  }
  console.log(`  ${JSON.stringify(reasons, null, 0)}`);

  // ============================================================
  // REVERSE GAP — SOURCE A orders with NO active PO.
  // ============================================================
  const activePOByQuote = new Map<string, any>();
  for (const p of activePOs) if (p.quotation_id) activePOByQuote.set(p.quotation_id, p);
  // also map active PO by affair to catch PO keyed on proforma of same affair
  const activePOByAffair = new Map<string, any[]>();
  for (const p of activePOs) { if (!p.affair_id) continue; if (!activePOByAffair.has(p.affair_id)) activePOByAffair.set(p.affair_id, []); activePOByAffair.get(p.affair_id)!.push(p); }
  let aWithoutActivePO = 0;
  const aOrphans: string[] = [];
  for (const d of sourceA) {
    const direct = activePOByQuote.has(d.id);
    const viaAffair = d.affair_id ? activePOByAffair.has(d.affair_id) : false;
    if (!direct && !viaAffair) { aWithoutActivePO++; aOrphans.push(`${d.number} (${cname(d.client_id)})`); }
  }
  console.log(`\n=========================================================`);
  console.log(`REVERSE GAP — current-board orders with NO active PO: ${aWithoutActivePO}`);
  for (const o of aOrphans.slice(0, 12)) console.log(`   • ${o}`);

  // ============================================================
  // AFFAIR coverage — distinct affairs in each source.
  // ============================================================
  const affA = new Set(sourceA.map((d: any) => d.affair_id).filter(Boolean));
  const affB = new Set(activePOs.map((p: any) => p.affair_id).filter(Boolean));
  console.log(`\n=========================================================`);
  console.log(`AFFAIR coverage — distinct affair_id`);
  console.log(`  source A (won+tasklist): ${affA.size}`);
  console.log(`  source B (active POs)  : ${affB.size}`);
  console.log(`  active POs with null affair_id: ${activePOs.filter((p: any) => !p.affair_id).length}`);

  // ============================================================
  // SOURCE C — proforma-anchored (the COMMAND). The proforma is what
  // launchProduction creates and what task lists + POs actually key on.
  // Sizes the PRE-PO window that "active POs only" would miss.
  // ============================================================
  const liveProformas = docs.filter((d: any) => d.type === "proforma" && !d.archived_at && d.status !== "cancelled");
  let pfWithTL = 0, pfWithActivePO = 0, pfTLnoPO = 0, pfNeither = 0;
  for (const pf of liveProformas) {
    const hasTL = tlByQuoteId.has(pf.id);
    const hasPO = activePOByQuote.has(pf.id);
    if (hasTL) pfWithTL++;
    if (hasPO) pfWithActivePO++;
    if (hasTL && !hasPO) pfTLnoPO++;
    if (!hasTL && !hasPO) pfNeither++;
  }
  console.log(`\n=========================================================`);
  console.log(`SOURCE C (proforma-anchored / the command)`);
  console.log(`  live proformas              : ${liveProformas.length}`);
  console.log(`  …with a task list           : ${pfWithTL}`);
  console.log(`  …with an ACTIVE PO          : ${pfWithActivePO}`);
  console.log(`  …task list but NO active PO : ${pfTLnoPO}   <-- PRE-PO window (active-PO-only misses these)`);
  console.log(`  …neither TL nor PO          : ${pfNeither}`);

  const tlStatus: Record<string, number> = {};
  for (const t of tls) if (!t.archived_at) tlStatus[t.status] = (tlStatus[t.status] ?? 0) + 1;
  console.log(`  live task_list status mix   : ${JSON.stringify(tlStatus)}`);

  const tlQuoteIdsWithActivePO = new Set(activePOs.map((p: any) => p.quotation_id).filter(Boolean));
  const tlNoActivePO = tls.filter((t: any) => !t.archived_at && t.status !== "cancelled" && !tlQuoteIdsWithActivePO.has(t.quotation_id));
  console.log(`  EXECUTION UNIVERSE = active PO ∪ live task list w/o active PO: ${activePOs.length} + ${tlNoActivePO.length} = ${activePOs.length + tlNoActivePO.length}`);

  // ============================================================
  // PROFORMA-ANCHOR FEASIBILITY — per-command resolution: does each live
  // proforma carry lines + resolve to a task list + (maybe) a PO? Any 1→N PO?
  // ============================================================
  const proformaIds = liveProformas.map((d: any) => d.id);
  const lineCountByDoc = new Map<string, number>();
  if (proformaIds.length) {
    const { data: lns } = await sb.from("document_lines").select("document_id").in("document_id", proformaIds).limit(5000);
    for (const l of (lns ?? []) as any[]) lineCountByDoc.set(l.document_id, (lineCountByDoc.get(l.document_id) ?? 0) + 1);
  }
  const tlByProforma = new Map<string, any>();
  for (const t of tls) { if (!t.quotation_id) continue; if (!tlByProforma.has(t.quotation_id)) tlByProforma.set(t.quotation_id, t); }
  const activePoByProforma = new Map<string, any[]>();
  for (const p of activePOs) { if (!p.quotation_id) continue; if (!activePoByProforma.has(p.quotation_id)) activePoByProforma.set(p.quotation_id, []); activePoByProforma.get(p.quotation_id)!.push(p); }
  let multiPO = 0;
  console.log(`\n=========================================================`);
  console.log(`PROFORMA-ANCHOR FEASIBILITY — the execution affairs`);
  for (const pf of liveProformas) {
    const tl = tlByProforma.get(pf.id);
    const pos2 = activePoByProforma.get(pf.id) ?? [];
    if (pos2.length > 1) multiPO++;
    console.log(`   • ${pf.number}  pf=${pf.status}  ${cname(pf.client_id)}  lines=${lineCountByDoc.get(pf.id) ?? 0}  TL=${tl?.status ?? "none"}  PO=${pos2.map((p: any) => p.status).join(",") || "none"}`);
  }
  console.log(`  proformas with >1 active PO : ${multiPO}`);
  console.log(`  proformas with 0 lines      : ${liveProformas.filter((pf: any) => !lineCountByDoc.get(pf.id)).length}`);

  await sb.auth.signOut();
}
main().catch((e) => { console.error(e); process.exit(1); });
