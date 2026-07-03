// =====================================================================
// SMOKE — Deposit & Balance invoicing (m141) on a real session.
// 1. Sign in to Supabase as the sales account (anon key, real JWT) and
//    find a WON quotation (fallback: a proforma).
// 2. Playwright: real /login as sales, open /documents/<id>, assert the
//    page still renders AND the Payment Schedule section is present —
//    either the live card (m141 applied) or the migration hint (not yet
//    applied). Both prove the page integrates without crashing.
//
// Run (from ~/dev/facturation, dev server on :3000):
//   node --env-file=.env.local --env-file=.env.e2e \
//     --experimental-strip-types e2e/audit/invoicing-smoke.ts
// =====================================================================

import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || "";
const BASE = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PASSWORD = process.env.E2E_PASSWORD || "";
const EMAIL = process.env.E2E_SALES_EMAIL || "";

if (!URL_ || !ANON || !PASSWORD || !EMAIL) {
  console.error("[invoicing-smoke] missing env (URL/ANON/PASSWORD/SALES_EMAIL)");
  process.exit(1);
}

const OUT_DIR = path.join("e2e", ".runs", "invoicing-smoke");
fs.mkdirSync(OUT_DIR, { recursive: true });

async function findTargetDoc(): Promise<{ id: string; number: string | null } | null> {
  const sb = createClient(URL_, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: signErr } = await sb.auth.signInWithPassword({
    email: EMAIL,
    password: PASSWORD,
  });
  if (signErr) {
    console.error(`[invoicing-smoke] supabase login failed: ${signErr.message}`);
    return null;
  }
  for (const filter of [
    { type: "quotation", status: "won" },
    { type: "proforma", status: null as string | null },
  ]) {
    let q = sb
      .from("documents")
      .select("id, number, type, status")
      .eq("type", filter.type)
      .order("date", { ascending: false })
      .limit(1);
    if (filter.status) q = q.eq("status", filter.status);
    const { data } = await q;
    if (data?.length) return data[0] as any;
  }
  return null;
}

async function main() {
  const target = await findTargetDoc();
  if (!target) {
    console.error("[invoicing-smoke] no won quotation / proforma visible to sales — nothing to probe");
    process.exit(2);
  }
  console.log(`[invoicing-smoke] target document: ${target.number ?? target.id}`);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  // Real login — no View-As.
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([
    page
      .waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 45000 })
      .catch(() => {}),
    page.click('button[type="submit"], button:has-text("Sign in")'),
  ]);
  if (new URL(page.url()).pathname.endsWith("/login")) {
    console.error("[invoicing-smoke] UI login failed");
    await browser.close();
    process.exit(1);
  }

  const resp = await page.goto(`${BASE}/documents/${target.id}`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForTimeout(1500);
  const status = resp?.status() ?? 0;
  const body = (await page.textContent("body")) ?? "";
  await page.screenshot({ path: path.join(OUT_DIR, "document-page.png"), fullPage: true });

  const pageAlive = status === 200 && /Payment terms|Totals/i.test(body);
  const hasCard = /Payment Schedule/i.test(body);
  const hasHint = /apply migration m141/i.test(body);
  const hasCreate = /Create Invoice/i.test(body);

  console.log(`[invoicing-smoke] HTTP ${status}`);
  console.log(`[invoicing-smoke] page alive:            ${pageAlive ? "YES" : "NO"}`);
  console.log(`[invoicing-smoke] Payment Schedule card:  ${hasCard ? "YES" : "no"}`);
  console.log(`[invoicing-smoke] m141 hint (pre-apply):  ${hasHint ? "YES" : "no"}`);
  console.log(`[invoicing-smoke] Create Invoice button:  ${hasCreate ? "YES" : "no"}`);
  console.log(`[invoicing-smoke] screenshot: ${path.join(OUT_DIR, "document-page.png")}`);

  await browser.close();
  // PASS = the page renders and the feature surface is present in one of
  // its two legitimate states (live card, or migration hint pre-m141).
  if (pageAlive && (hasCard || hasHint)) {
    console.log("[invoicing-smoke] PASS");
    process.exit(0);
  }
  console.error("[invoicing-smoke] FAIL — section absent or page broken");
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
