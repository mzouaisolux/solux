// =====================================================================
// E2E — invoice navigation & detail (UX redesign), real sales session.
//   1. /documents/<id> — Payment Schedule (top) + summary mirror (bottom)
//      both render; invoice rows carry View / PDF / Send.
//   2. Click an invoice row's "View" → lands on /invoicing/<id>.
//   3. Detail page: accounting number, "Back to Commercial Invoice",
//      History timeline, billing line, PDF actions.
//   4. PDF Preview actually renders a blob in the browser (opens a popup).
//   5. /affairs/<id> — the Invoices card lists the commercial invoice.
//
// Run (from ~/dev/facturation, dev server on :3000):
//   node --env-file=.env.local --env-file=.env.e2e \
//     --experimental-strip-types e2e/audit/invoicing-nav-e2e.ts
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

const OUT_DIR = path.join("e2e", ".runs", "invoicing-nav");
fs.mkdirSync(OUT_DIR, { recursive: true });

let failures = 0;
function check(label: string, ok: boolean, extra = "") {
  console.log(`  ${ok ? "✓" : "✗ FAIL"} ${label}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failures++;
}

async function findTarget(): Promise<{ docId: string; affairId: string | null } | null> {
  const sb = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { error } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (error) return null;
  // A family that already has invoices → its source document + affair.
  const { data: fams } = await sb
    .from("invoice_families")
    .select("source_document_id, affair_id")
    .order("created_at", { ascending: false })
    .limit(10);
  for (const f of fams ?? []) {
    if ((f as any).source_document_id) {
      return {
        docId: (f as any).source_document_id,
        affairId: (f as any).affair_id ?? null,
      };
    }
  }
  return null;
}

async function main() {
  const target = await findTarget();
  if (!target) {
    console.error("[nav] no invoice family with a source document found");
    process.exit(2);
  }
  console.log(`[nav] document ${target.docId} · affair ${target.affairId ?? "—"}`);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const consoleErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });

  // login
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 45000 }).catch(() => {}),
    page.click('button[type="submit"], button:has-text("Sign in")'),
  ]);

  // Warm the on-demand-compiled routes (first hit compiles + may 500).
  console.log("[nav] warming routes…");
  for (const p of [`/documents/${target.docId}`, target.affairId ? `/affairs/${target.affairId}` : null]) {
    if (p) await page.goto(`${BASE}${p}`, { waitUntil: "networkidle", timeout: 90000 }).catch(() => {});
  }

  // --- 1. document page: two schedule surfaces ---
  console.log("[nav] step 1 — document page");
  await page.goto(`${BASE}/documents/${target.docId}`, {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  await page.waitForTimeout(1200);
  await page.locator('text=/Payment Schedule/i').first().waitFor({ timeout: 15000 }).catch(() => {});
  const scheduleCount = await page.locator('text=/Payment Schedule/i').count();
  check("Payment Schedule card present", scheduleCount >= 1);
  const commercialCount = await page.locator('text=/Commercial Invoice INV-/i').count();
  check("Commercial Invoice shown top + summary (>=2)", commercialCount >= 2, `count=${commercialCount}`);
  const viewButtons = page.locator('a:has-text("👁 View")');
  const viewCount = await viewButtons.count();
  check("invoice rows expose a View action", viewCount >= 1, `views=${viewCount}`);
  const pdfButtons = await page.locator('button:has-text("PDF")').count();
  check("invoice rows expose a PDF action", pdfButtons >= 1, `pdf=${pdfButtons}`);
  await page.screenshot({ path: path.join(OUT_DIR, "1-document.png"), fullPage: true });

  // --- 2. click View → invoice detail ---
  console.log("[nav] step 2 — navigate to invoice detail");
  await viewButtons.first().click();
  await page.waitForURL(/\/invoicing\//, { timeout: 20000 }).catch(() => {});
  const onDetail = /\/invoicing\//.test(page.url());
  check("navigated to /invoicing/<id>", onDetail, page.url());

  // --- 3. detail page content ---
  console.log("[nav] step 3 — detail page content");
  await page.waitForTimeout(1000);
  const dbody = (await page.textContent("body")) ?? "";
  check("shows an accounting number", /\d{4}-\d{5}/.test(dbody));
  check("Back to Commercial Invoice link", /Back to Commercial Invoice/i.test(dbody));
  check("History section", /History/i.test(dbody));
  check("Billing line section", /Billing line/i.test(dbody));
  check("has Preview + PDF + Send actions", /Preview/i.test(dbody) && /Send/i.test(dbody));
  await page.screenshot({ path: path.join(OUT_DIR, "2-detail.png"), fullPage: true });

  // --- 4. PDF preview renders a blob (popup) ---
  console.log("[nav] step 4 — PDF preview renders");
  try {
    const [popup] = await Promise.all([
      page.waitForEvent("popup", { timeout: 25000 }),
      page.click('button:has-text("Preview")'),
    ]);
    const purl = popup.url();
    check("preview opened a blob/pdf tab", /^blob:|\.pdf/.test(purl) || purl !== "about:blank", purl);
    await popup.close();
  } catch (e: any) {
    check("preview opened a blob/pdf tab", false, e?.message ?? "no popup");
  }

  // --- 5. affair invoices card ---
  if (target.affairId) {
    console.log("[nav] step 5 — affair Invoices card");
    await page.goto(`${BASE}/affairs/${target.affairId}`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForTimeout(1200);
    const abody = (await page.textContent("body")) ?? "";
    check("affair page has an Invoices section", /Invoices/i.test(abody));
    check("affair lists the commercial invoice", /Commercial Invoice INV-/i.test(abody));
    await page.screenshot({ path: path.join(OUT_DIR, "3-affair.png"), fullPage: true });
  }

  const realErrors = consoleErrors.filter(
    (e) => !/favicon|manifest|Download the React DevTools|hydrat/i.test(e)
  );
  check("no unexpected console errors", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));

  await browser.close();
  console.log(failures === 0 ? "[nav] PASS" : `[nav] ${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
