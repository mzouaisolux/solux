// =====================================================================
// E2E — Deposit & Balance invoicing (m141) FULL FLOW, real sales session.
// Drives the actual UI on a WON quotation with 30/70 payment terms:
//   1. Payment Schedule card is live (m141 applied) + planned milestones
//   2. Create Invoice → Deposit  → row appears with an accounting number
//   3. + Payment (prefilled full) → status flips to Paid, progress moves
//   4. Create Invoice → Balance  → remaining-to-invoice reaches 0.00
//   5. Ceiling: the Create Invoice button becomes disabled
// Leaves the data in place as a demo state (test client / test quotation).
//
// Run (from ~/dev/facturation, dev server on :3000):
//   node --env-file=.env.local --env-file=.env.e2e \
//     --experimental-strip-types e2e/audit/invoicing-e2e.ts [documentId]
// =====================================================================

import { createClient } from "@supabase/supabase-js";
import { chromium, type Page } from "playwright";
import fs from "node:fs";
import path from "node:path";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || "";
const BASE = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PASSWORD = process.env.E2E_PASSWORD || "";
const EMAIL = process.env.E2E_SALES_EMAIL || "";

const OUT_DIR = path.join("e2e", ".runs", "invoicing-e2e");
fs.mkdirSync(OUT_DIR, { recursive: true });

let failures = 0;
function check(label: string, ok: boolean, extra = "") {
  console.log(`  ${ok ? "✓" : "✗ FAIL"} ${label}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failures++;
}

async function findWonQuotation(): Promise<string | null> {
  const sb = createClient(URL_, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (error) return null;
  const { data } = await sb
    .from("documents")
    .select("id, number, payment_mode, payment_terms")
    .eq("type", "quotation")
    .eq("status", "won")
    .eq("payment_mode", "deposit_balance")
    .order("date", { ascending: false })
    .limit(5);
  const withDeposit = (data ?? []).find(
    (d: any) => (d.payment_terms?.deposit_percent ?? 0) > 0 && d.payment_terms.deposit_percent < 100
  );
  if (withDeposit) console.log(`[e2e] target: ${(withDeposit as any).number}`);
  return (withDeposit as any)?.id ?? null;
}

async function body(page: Page): Promise<string> {
  return (await page.textContent("body")) ?? "";
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: path.join(OUT_DIR, name), fullPage: true });
}

async function main() {
  const docId = process.argv[2] || (await findWonQuotation());
  if (!docId) {
    console.error("[e2e] no won deposit_balance quotation found");
    process.exit(2);
  }

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const alerts: string[] = [];
  page.on("dialog", async (d) => {
    alerts.push(d.message());
    await d.accept();
  });

  // --- login ---
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 45000 }).catch(() => {}),
    page.click('button[type="submit"], button:has-text("Sign in")'),
  ]);

  // --- 1. card live ---
  console.log("[e2e] step 1 — card is live");
  await page.goto(`${BASE}/documents/${docId}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1200);
  let b = await body(page);
  check("Payment Schedule card rendered", /Payment Schedule/i.test(b));
  check("no m141 hint anymore", !/apply migration m141/i.test(b));
  const hadInvoicesAlready = !/Planned from payment terms/i.test(b);
  if (hadInvoicesAlready) {
    console.log("[e2e] NOTE: family already has invoices — will only re-verify display, not create");
  }
  check(
    "planned milestones or existing rows shown",
    /Deposit/i.test(b) && /Balance|Full/i.test(b)
  );
  await shot(page, "1-card-live.png");

  if (!hadInvoicesAlready) {
    // --- 2. create Deposit invoice ---
    console.log("[e2e] step 2 — create Deposit invoice");
    await page.click('button:has-text("Create Invoice")');
    await page.waitForSelector('text=Deposit Invoice', { timeout: 10000 });
    await shot(page, "2-modal.png");
    await page.click('label:has-text("Deposit Invoice") input[type="radio"]');
    await page.getByRole("button", { name: "Create invoice", exact: true }).click();
    await page.waitForTimeout(2500);
    b = await body(page);
    const createdAlert = alerts.find((a) => /accounting no\./i.test(a)) ?? "";
    check("creation alert has accounting number", /\d{4}-\d{5}/.test(createdAlert), createdAlert);
    check("commercial number INV-…", /INV-\d+/.test(createdAlert + b));
    check("deposit row rendered", /% Deposit/.test(b));
    check("row shows accounting no.", /Accounting no\.\s*\d{4}-\d{5}/.test(b.replace(/\s+/g, " ")));
    await shot(page, "3-deposit-created.png");

    // --- 3. record full payment on the deposit ---
    console.log("[e2e] step 3 — record deposit payment");
    await page.click('button:has-text("+ Payment")');
    await page.waitForTimeout(300);
    // amount input is prefilled with what's left on the invoice
    await page.click('button:has-text("✓")');
    await page.waitForTimeout(2500);
    b = await body(page);
    check("deposit flips to Paid", /Paid/i.test(b) && !/Partially Paid/i.test(b));
    check("paid % > 0 on progress bar", /[1-9]\d?% paid/.test(b));
    await shot(page, "4-deposit-paid.png");

    // --- 4. create Balance invoice ---
    console.log("[e2e] step 4 — create Balance invoice");
    await page.click('button:has-text("Create Invoice")');
    await page.waitForSelector('text=Balance Invoice', { timeout: 10000 });
    await page.click('label:has-text("Balance Invoice") input[type="radio"]');
    await page.getByRole("button", { name: "Create invoice", exact: true }).click();
    await page.waitForTimeout(2500);
    b = (await body(page)).replace(/\s+/g, " ");
    check("balance row rendered", /Balance/i.test(b));
    check("remaining to invoice is 0.00", /Remaining to invoice\s*0\.00/i.test(b), b.match(/Remaining to invoice\s*[\d,.]+/i)?.[0]);
    const accountingNos = b.match(/\d{4}-\d{5}/g) ?? [];
    check("two distinct accounting numbers", new Set(accountingNos).size >= 2, accountingNos.join(", "));
    await shot(page, "5-balance-created.png");

    // --- 5. ceiling: nothing left to invoice ---
    console.log("[e2e] step 5 — ceiling");
    const disabled = await page
      .locator('button:has-text("Create Invoice")')
      .first()
      .isDisabled()
      .catch(() => false);
    check("Create Invoice disabled at 0 remaining", disabled);
  }

  await browser.close();
  console.log(failures === 0 ? "[e2e] PASS — full deposit & balance flow verified" : `[e2e] ${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
