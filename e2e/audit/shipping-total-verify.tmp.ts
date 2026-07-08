// =====================================================================
// TEMP VERIFY — m149 completion recomputes documents.total_price
// (+ commission_amount) with the builder math (lib/document-total).
//
//  A. seed a QA quotation under the REAL sales JWT (DB insert, pattern
//     seed-order.ts): 1 line @ 5000, insurance 5.50, no freight →
//     total_price 5005.50 (builder formula).
//  B. real SALES login → requests a Shipping Update from the doc page.
//  C. real OPS login → queue → completes it: flat freight 800,
//     insurance 220, additional charge FERI 300.
//  D. document page must agree with itself:
//     Grand total == Items + Freight + Insurance + Charges (== 6320.00)
//     (before the fix the stored total stayed at its save-time value).
//  E. DB double-check under the sales JWT (total_price recomputed, event
//     payload carries new_total_price).
//
// Run: node --env-file=.env.local --env-file=.env.e2e \
//        --experimental-strip-types e2e/audit/shipping-total-verify.tmp.ts
// =====================================================================
import { chromium, type Browser, type Page } from "playwright";
import { createClient } from "@supabase/supabase-js";

const BASE = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PASSWORD = process.env.E2E_PASSWORD || "";
const SALES = process.env.E2E_SALES_EMAIL || "";
const OPS = process.env.E2E_OPERATION_EMAIL || "";
const CLIENT_ID = "d6b411fb-b236-4302-92fc-03ff825cfe12"; // QA COCKPIT CLIENT 46594
const CLIENT_NAME = "QA COCKPIT CLIENT 46594";
const AFFAIR = `QA SHIPTOTAL ${new Date().toISOString().slice(11, 19).replace(/:/g, "")}`;

let failures = 0;
function check(label: string, ok: boolean, extra = "") {
  console.log(`  ${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failures++;
}
const near = (a: number, b: number, tol = 0.011) => Math.abs(a - b) < tol;

async function login(browser: Browser, email: string): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept().catch(() => {}));
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 90000 }),
    page.click('button:has-text("Sign in")'),
  ]);
  console.log(`[login] ${email} → ${page.url()}`);
  return page;
}

/** Parse the document page "Totals" <dl> into {label: amount}. */
async function readTotals(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() => {
    const out: Record<string, number> = {};
    for (const dl of Array.from(document.querySelectorAll("dl"))) {
      const rows = Array.from(dl.querySelectorAll("div"));
      const labels = rows.map((r) => r.querySelector("dt")?.textContent?.trim() || "");
      if (!labels.some((l) => l.startsWith("Grand total"))) continue;
      for (const r of rows) {
        const dt = r.querySelector("dt")?.textContent?.trim() || "";
        const dd = r.querySelector("dd")?.textContent?.trim() || "";
        const n = Number(dd.replace(/,/g, ""));
        if (dt && Number.isFinite(n)) out[dt.replace(/\s+/g, " ")] = n;
      }
      break;
    }
    return out;
  });
}

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const browser = await chromium.launch({ headless: true });

  // ---------- A. seed the QA quotation under the sales JWT ----------
  console.log(`\n[A] seed QA quotation (${AFFAIR}) under the sales JWT`);
  const { data: session, error: authErr } = await sb.auth.signInWithPassword({ email: SALES, password: PASSWORD });
  check("sales JWT", !!session?.user && !authErr, authErr?.message);
  const uid = session!.user!.id;

  // Reuse an existing affair of the QA client (affairs RLS blocks direct
  // inserts under the sales JWT — the app creates them via a server action).
  const { data: aff, error: affErr } = await sb
    .from("affairs")
    .select("id, name")
    .eq("client_id", CLIENT_ID)
    .limit(1)
    .maybeSingle();
  check("QA affair available", !!aff, affErr?.message ?? "client has no affair");
  if (aff) console.log(`  using affair "${aff.name}" (${aff.id})`);

  const number = `QA-SHIPTOTAL-${Date.now().toString(36).toUpperCase()}`;
  const { data: seeded, error: docSeedErr } = await sb
    .from("documents")
    .insert({
      client_id: CLIENT_ID,
      affair_id: aff!.id,
      type: "quotation",
      status: "draft",
      number,
      freight_cost: 0,
      total_price: 5005.5, // 5000 items + 5.50 insurance (builder formula)
      insurance_cost: 5.5,
      additional_charges: [],
      commission_enabled: false,
      commission_percentage: 0,
      commission_amount: 0,
      currency: "USD",
      manual_pricing: true,
      created_by: uid,
    })
    .select("id")
    .single();
  check("QA quotation seeded", !!seeded, docSeedErr?.message);
  if (!seeded) {
    await browser.close();
    process.exit(1);
  }
  const docId = seeded.id as string;
  const { error: lineErr } = await sb.from("document_lines").insert({
    document_id: docId,
    product_id: null,
    quantity: 1,
    unit_price: 5000,
    total_price: 5000,
    client_product_name: "QA SHIPTOTAL ITEM",
    config_values: {},
  });
  check("QA line inserted (1 × 5000)", !lineErr, lineErr?.message);
  console.log(`  doc ${number} (${docId})`);

  // ---------- B'. SALES login → document page renders the seed ----------
  const sales = await login(browser, SALES);
  await sales.goto(`${BASE}/documents/${docId}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await sales.waitForSelector("text=Grand total", { timeout: 60000 });
  const t0 = await readTotals(sales);
  const grand0 = t0["Grand total"] ?? NaN;
  console.log(`  initial totals: ${JSON.stringify(t0)}`);
  check("initial Grand total == parts (builder)", near(grand0, (t0["Items"] ?? 0) + (t0["Freight"] ?? 0) + (t0["Insurance"] ?? 0)), String(grand0));

  // ---------- B. SALES — request the shipping update ----------
  console.log(`\n[B] sales requests a shipping update`);
  for (let i = 0; i < 4; i++) {
    await sales.locator('button:has-text("Request Shipping Update")').first().click().catch(() => {});
    const opened = await sales
      .waitForSelector('button:has-text("Send to Operations")', { timeout: 4000 })
      .then(() => true)
      .catch(() => false);
    if (opened) break;
    await sales.waitForTimeout(1500);
  }
  await sales.locator('button:has-text("Send to Operations")').click({ timeout: 8000 });
  await sales.waitForSelector("text=Update requested", { timeout: 20000 }).catch(() => {});
  check("request visible on the doc page", (await sales.locator("text=Update requested").count()) > 0);

  // ---------- C. OPS — complete with the new costs ----------
  console.log(`\n[C] ops completes: freight 800, insurance 220, FERI 300`);
  const ops = await login(browser, OPS);
  await ops.goto(`${BASE}/operations/shipping-updates`, { waitUntil: "domcontentloaded", timeout: 120000 });
  const row = ops.locator(`tr:has(a[href="/documents/${docId}"])`).first();
  await row.waitFor({ state: "visible", timeout: 60000 });
  for (let i = 0; i < 4; i++) {
    await row.locator('button:has-text("Open")').first().click().catch(() => {});
    const opened = await ops
      .waitForSelector("text=New shipping cost", { timeout: 4000 })
      .then(() => true)
      .catch(() => false);
    if (opened) break;
    await ops.waitForTimeout(1500);
  }
  // No containers on this doc → flat "New freight total" input.
  await ops.locator('label:has-text("New freight total") input').fill("800");
  await ops.locator('label:has-text("Insurance (recalculated)") input').fill("220");
  await ops.locator('button:has-text("+ Add charge")').click();
  await ops.locator('input[placeholder*="ECTN"]').last().fill("FERI");
  await ops.locator('input[placeholder="0.00"]').last().fill("300");
  await ops.locator('button:has-text("Complete & update document")').click({ timeout: 10000 });
  await ops.waitForTimeout(3500);

  // ---------- D. document page must agree with itself ----------
  console.log(`\n[D] document page after completion`);
  await ops.goto(`${BASE}/documents/${docId}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await ops.waitForSelector("text=Grand total", { timeout: 60000 });
  const t1 = await readTotals(ops);
  console.log(`  totals now: ${JSON.stringify(t1)}`);
  const items = t1["Items"] ?? NaN;
  const freight = t1["Freight"] ?? NaN;
  const insurance = t1["Insurance"] ?? 0;
  const feri = t1["FERI"] ?? 0;
  const grand = t1["Grand total"] ?? NaN;
  check("Freight shows the new 800.00", near(freight, 800), String(freight));
  check("Insurance shows the new 220.00", near(insurance, 220), String(insurance));
  check("FERI charge shows 300.00", near(feri, 300), String(feri));
  check(
    "Grand total == Items + Freight + Insurance + Charges (page agrees with itself)",
    near(grand, items + freight + insurance + feri),
    `${grand} vs ${items + freight + insurance + feri}`
  );
  check("Grand total actually moved (recompute happened)", !near(grand, grand0), `${grand0} → ${grand}`);
  check("Grand total == 6320.00 (5000 + 800 + 220 + 300)", near(grand, 6320), String(grand));

  await browser.close();

  // ---------- E. DB post-check under the sales JWT ----------
  console.log(`\n[E] DB post-check`);
  const { data: doc, error: docErr } = await sb
    .from("documents")
    .select("id, number, total_price, freight_cost, insurance_cost, additional_charges, commission_enabled, commission_amount")
    .eq("id", docId)
    .maybeSingle();
  const { data: lines } = await sb.from("document_lines").select("total_price").eq("document_id", docId);
  const itemsDb = (lines ?? []).reduce((s, l: any) => s + (Number(l.total_price) || 0), 0);
  check("doc row readable", !!doc, docErr?.message);
  if (doc) {
    const chargesDb = Array.isArray(doc.additional_charges) ? doc.additional_charges : [];
    const chargesTotal = chargesDb.reduce((s: number, c: any) => s + (Number(c?.amount) || 0), 0);
    const expected = itemsDb + Number(doc.freight_cost) + Number(doc.commission_amount || 0) + Number(doc.insurance_cost || 0) + chargesTotal;
    console.log(
      `  ${doc.number}: items=${itemsDb} freight=${doc.freight_cost} commission=${doc.commission_amount} insurance=${doc.insurance_cost} charges=${chargesTotal} → total_price=${doc.total_price}`
    );
    check("DB total_price == items + freight + commission + extras", near(Number(doc.total_price), expected, 0.005), `${doc.total_price} vs ${expected}`);
    check("DB freight_cost == 800", near(Number(doc.freight_cost), 800));
    check("DB insurance_cost == 220", near(Number(doc.insurance_cost), 220));
  }
  const { data: evts } = await sb
    .from("events")
    .select("event_type, payload")
    .eq("entity_id", docId)
    .eq("event_type", "doc.shipping_update_completed")
    .order("created_at", { ascending: false })
    .limit(1);
  const evt: any = (evts ?? [])[0];
  if (evt) {
    check(
      "event payload carries new_total_price == stored total",
      near(Number(evt.payload?.new_total_price), Number(doc?.total_price), 0.005),
      JSON.stringify(evt.payload ?? {})
    );
  } else {
    console.log("  (event row not readable under sales JWT — skipped)");
  }
  await sb.auth.signOut();

  console.log(`\n[verify] ${failures === 0 ? "ALL CHECKS PASSED ✅" : `${failures} CHECK(S) FAILED ❌`}`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
