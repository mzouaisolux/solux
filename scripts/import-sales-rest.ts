// =====================================================================
// SALES-HISTORY IMPORT (REST variant) — no DATABASE_URL needed.
//
// This environment has no Postgres connection string, only the anon key. The
// m138 RLS lets an admin/super_admin (and operations/finance/sales_director)
// WRITE the register, so we import via PostgREST under a signed-in admin
// session instead of raw SQL. Same pure libs, same idempotent keys, same §7
// reconciliation as scripts/import-sales-history.ts (the pg variant).
//
//   node --env-file=.env.local --env-file=.env.e2e \
//     --experimental-strip-types scripts/import-sales-rest.ts
//   (or: npm run import:sales:rest)
//
// Idempotent: every write is an upsert on a natural key. Re-running is safe.
// =====================================================================
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  parseOrdersCsv,
  parseClientsCsv,
  parseMonthlySalesCsv,
  parseMergeSuggestionsCsv,
  type OrderRow,
} from "../lib/sales/csv.ts";
import { normalizedClientKey } from "../lib/sales/client-key.ts";
import { reconcile, EXPECTED } from "../lib/sales/reconcile.ts";
import { indexMonthlyBySalerYear, type MonthlyLike } from "../lib/sales/kpi.ts";

const DATA = path.join(process.cwd(), "data");
const HISTORICAL_CURRENCY = "USD";
const MONEY_TOL = 2;
const read = (f: string) => fs.readFileSync(path.join(DATA, f), "utf8");

function importKey(o: OrderRow): string {
  const parts = [
    o.client_id, o.pi_no, o.year, o.month, o.order_date, o.pi_amount, o.sales_amount,
    o.transportation, o.received_amount, o.bank_charge, o.balance, o.shipment_date,
    o.eta_note, o.pickup, o.client_raw, o.country_raw, o.saler_raw,
  ];
  return crypto.createHash("sha1").update(parts.map((p) => (p == null ? "" : String(p))).join("")).digest("hex");
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const email = process.env.E2E_ADMIN_EMAIL || process.env.SALES_IMPORT_EMAIL || "";
const password = process.env.E2E_PASSWORD || process.env.SALES_IMPORT_PASSWORD || "";
const sb = createClient(url, anon, { auth: { persistSession: false } });

async function upsertBatched(table: string, rows: any[], opts: any, batch = 500): Promise<void> {
  for (let i = 0; i < rows.length; i += batch) {
    const { error } = await sb.from(table).upsert(rows.slice(i, i + batch), opts);
    if (error) throw new Error(`${table} upsert [${i}]: ${error.code} — ${error.message}`);
  }
}
async function countRows(table: string): Promise<number> {
  const { count, error } = await sb.from(table).select("*", { count: "exact", head: true });
  if (error) throw new Error(`count ${table}: ${error.message}`);
  return count ?? 0;
}

async function main(): Promise<void> {
  const orders = parseOrdersCsv(read("orders.csv"));
  const clients = parseClientsCsv(read("clients.csv"));
  const monthly = parseMonthlySalesCsv(read("monthly_sales.csv"));
  const mergePath = path.join(DATA, "merge_suggestions.csv");
  const merges = fs.existsSync(mergePath) ? parseMergeSuggestionsCsv(fs.readFileSync(mergePath, "utf8")) : [];

  const pre = reconcile({ orders, clients, monthly });
  if (!pre.ok) { console.error("✗ pre-import reconciliation FAILED:\n  " + pre.failures.join("\n  ")); process.exit(1); }
  console.log(`✓ CSV reconciliation OK — ${orders.length} orders, ${clients.length} clients, ${monthly.length} monthly, ${merges.length} merge suggestions.`);

  if (!email || !password) { console.error("✗ need E2E_ADMIN_EMAIL + E2E_PASSWORD (or SALES_IMPORT_EMAIL/PASSWORD) to sign in."); process.exit(2); }
  const { error: authErr } = await sb.auth.signInWithPassword({ email, password });
  if (authErr) { console.error("✗ sign-in failed: " + authErr.message); process.exit(2); }
  console.log(`✓ signed in as ${email}`);

  // 1. salers
  const salerNames = [...new Set([...monthly.map((m) => m.saler), ...orders.map((o) => (o.saler ?? "").toUpperCase())].filter(Boolean))];
  const { data: salerRows, error: se } = await sb.from("salers").upsert(salerNames.map((name) => ({ name })), { onConflict: "name" }).select("id, name");
  if (se) throw new Error("salers: " + se.message);
  const salerId = new Map<string, string>((salerRows ?? []).map((r: any) => [r.name, r.id]));

  // 2. sales_clients
  const { data: clientRows, error: ce } = await sb.from("sales_clients")
    .upsert(clients.map((c) => ({ code: c.client_id, name: c.client_name, main_country: c.main_country, first_year: c.first_year, last_year: c.last_year })), { onConflict: "code" })
    .select("id, code");
  if (ce) throw new Error("sales_clients: " + ce.message);
  const clientId = new Map<string, string>((clientRows ?? []).map((r: any) => [r.code, r.id]));

  // 3. aliases — dedupe globally by normalized_key (first client to claim it wins)
  const aliasByKey = new Map<string, any>();
  let aliasCollisions = 0;
  for (const c of clients) {
    const scid = clientId.get(c.client_id);
    for (const raw of [c.client_name, ...c.spelling_variants]) {
      const key = normalizedClientKey(raw);
      if (!key) continue;
      if (aliasByKey.has(key)) { aliasCollisions++; continue; }
      aliasByKey.set(key, { sales_client_id: scid, raw_text: raw, normalized_key: key, source: "import" });
    }
  }
  await upsertBatched("sales_client_aliases", [...aliasByKey.values()], { onConflict: "normalized_key", ignoreDuplicates: true });

  // 4. sales_orders — key by import_key. orders.csv can contain BYTE-IDENTICAL
  //    duplicate rows (a real one exists: C0004/SLXARRCOCMP24008). The owner's
  //    control count (1314) includes them, so a repeated key gets a stable
  //    occurrence suffix (#2, #3…) instead of collapsing.
  const orderByKey = new Map<string, any>();
  const keySeen = new Map<string, number>();
  for (const o of orders) {
    const base = importKey(o);
    const n = (keySeen.get(base) ?? 0) + 1;
    keySeen.set(base, n);
    const k = n === 1 ? base : `${base}#${n}`;
    orderByKey.set(k, {
      sales_client_id: clientId.get(o.client_id) ?? null,
      saler_id: o.saler ? (salerId.get(o.saler.toUpperCase()) ?? null) : null,
      year: o.year, month: o.month, order_date: o.order_date, country: o.country, pi_no: o.pi_no, payment_terms: o.payment_terms,
      pi_amount: o.pi_amount, sales_amount: o.sales_amount, transportation: o.transportation, received_amount: o.received_amount,
      bank_charge: o.bank_charge, balance: o.balance, amount_status: "invoiced", currency: HISTORICAL_CURRENCY,
      shipment_date: o.shipment_date, eta_note: o.eta_note, pickup: o.pickup,
      client_raw: o.client_raw, country_raw: o.country_raw, saler_raw: o.saler_raw,
      source: "excel_import", import_key: k,
    });
  }
  await upsertBatched("sales_orders", [...orderByKey.values()], { onConflict: "import_key" });

  // 5. monthly_sales_history
  await upsertBatched(
    "monthly_sales_history",
    monthly.map((m) => ({ year: m.year, month: m.month, label: m.label, saler_id: salerId.get(m.saler) ?? null, sales: m.sales, is_reconstructed: m.is_reconstructed })),
    { onConflict: "year,month,saler_id" },
  );

  // 6. merge suggestions → pending queue (by exact canonical name)
  const byName = new Map<string, string[]>();
  for (const c of clients) {
    const k = c.client_name.trim().toLowerCase();
    if (!k) continue;
    const arr = byName.get(k) ?? [];
    arr.push(clientId.get(c.client_id) as string);
    byName.set(k, arr);
  }
  const mergeRows: any[] = [];
  let mergeSkipped = 0;
  for (const s of merges) {
    const a = byName.get(s.client_a.trim().toLowerCase());
    const b = byName.get(s.client_b.trim().toLowerCase());
    if (!a || !b || a.length !== 1 || b.length !== 1) { mergeSkipped++; console.warn(`  · merge skipped (ambiguous): "${s.client_a}" ↔ "${s.client_b}"`); continue; }
    mergeRows.push({ client_a_id: a[0], client_b_id: b[0], score: s.score, source: "import", status: "pending" });
  }
  if (mergeRows.length) await upsertBatched("sales_merge_suggestions", mergeRows, { onConflict: "client_a_id,client_b_id", ignoreDuplicates: true });

  // ── POST-IMPORT reconciliation (against the DB) ──────────────────────────
  const failures: string[] = [];
  const oc = await countRows("sales_orders"); if (oc !== EXPECTED.ordersTotal) failures.push(`sales_orders = ${oc} (expected ${EXPECTED.ordersTotal})`);
  const cc = await countRows("sales_clients"); if (cc !== EXPECTED.clientsTotal) failures.push(`sales_clients = ${cc} (expected ${EXPECTED.clientsTotal})`);

  // saler controls: re-read monthly from DB (with saler name) and recompute.
  const { data: dbMonthly, error: me } = await sb.from("monthly_sales_history").select("year, month, sales, saler:saler_id(name)");
  if (me) throw new Error("read monthly: " + me.message);
  const mlike: MonthlyLike[] = (dbMonthly ?? []).map((r: any) => ({ year: Number(r.year), month: Number(r.month), saler: r.saler?.name ?? "—", sales: Number(r.sales) || 0 }));
  const idx = indexMonthlyBySalerYear(mlike);
  for (const c of EXPECTED.salerControls) {
    const got = idx.get(`${c.saler}|${c.year}`) ?? 0;
    if (Math.abs(got - c.expected) > MONEY_TOL) failures.push(`${c.saler} ${c.year} = ${got} (expected ${c.expected})`);
  }

  if (failures.length) { console.error("✗ POST-IMPORT reconciliation FAILED:\n  " + failures.join("\n  ")); process.exit(1); }

  console.log(`✅ imported — ${clients.length} clients, ${aliasByKey.size} aliases (${aliasCollisions} collisions surfaced), ${orderByKey.size} orders, ${monthly.length} monthly rows, ${mergeRows.length} merge suggestions (${mergeSkipped} skipped).`);
  console.log("✅ post-import reconciliation OK — 1314 orders / 203 clients / saler controls all green.");
}

main().catch((e) => { console.error(e); process.exit(1); });
