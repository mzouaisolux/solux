// m159 — Industrial Production File sections in the Production Dossier PDF.
// Captures the browser-generated dossier from the task list page (real TLM
// login, real app bundle, real @react-pdf + pdf-lib pipeline).
//
// Two modes:
//   default   — the m159 columns are SIMULATED at the PostgREST boundary
//               (Playwright route interception on the exportData defensive
//               select), because the live DB does not have m159 applied yet.
//               Proves the new sections render with full data.
//   --dormant — no interception: the live pre-m159 DB answers 42703 and the
//               dossier must generate cleanly WITHOUT the new sections.
//
//   node --env-file=.env.local --env-file=.env.e2e --experimental-strip-types e2e/audit/industrial-dossier-pdf.ts [--dormant]
//
// Verify the produced PDFs with e2e/audit/industrial-dossier-pdf-text.ts.
import { chromium, type Page } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PW = process.env.E2E_PASSWORD || "";
const DORMANT = process.argv.includes("--dormant");
const OUT = path.join("e2e", ".runs", "m159");
// PTL-SLX-AFR-26-002 (production_ready). Override with E2E_TASK_LIST_ID.
const TL = process.env.E2E_TASK_LIST_ID || "e97ddf57-c15b-46d7-a50d-1940d31430f0";
const PDF = path.join(OUT, DORMANT ? "dossier-dormant.pdf" : "dossier-m159.pdf");

// The m159 payload the PostgREST boundary returns (exactly the columns the
// exportData defensive select asks for). Exercises every subsection: tilt +
// verified checkpoint, an EXCLUDED catalog accessory, a custom accessory,
// customized-client packaging, SOLUX manual EN/FR/AR, spare parts with
// factory naming.
const M159_ROW = {
  solar_panel_tilt_angle: 20,
  pole_drawing_tilt_verified: true,
  pole_drawing_tilt_verified_at: "2026-07-08T10:00:00Z",
  industrial_spec: {
    pole_accessories: {
      items: [
        { key: "anchor_bolts", label: "Anchor bolts", included: true, note: "M24 x 800mm" },
        { key: "nut_caps", label: "Nut caps", included: false, note: null },
        { key: "custom", label: "Anti-theft screws kit", included: true, note: "Stainless A2", custom: true },
      ],
      notes: "Pack accessories per pole in one labeled bag.",
    },
    packaging: { version: "custom_client", notes: "Client logo on both sides of the carton." },
    user_manual: { brand: "solux", languages: ["en", "fr", "ar"], notes: "Include QR code page." },
    spare_parts: [
      {
        part: "Battery", model: "SLX-BAT-538", product_id: null, quantity: 2,
        notes: "Ship inside pole box", factory_name: "电池组件 BT-538",
        customer_name: "Power pack", factory_notes: "Factory Y naming",
      },
      {
        part: "Controller", model: "CTRL-V5", product_id: null, quantity: 1,
        notes: null, factory_name: null, customer_name: null, factory_notes: null,
      },
    ],
  },
};

async function ensureLogin(browser: any, role: string): Promise<{ ctx: any; page: Page }> {
  const email = process.env[`E2E_${role.toUpperCase()}_EMAIL`] || "";
  const AUTH = path.join("e2e", ".auth", `${role}.json`);
  let ctx = await browser.newContext({ acceptDownloads: true, ...(fs.existsSync(AUTH) ? { storageState: AUTH } : {}) });
  let page = await ctx.newPage();
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(700);
  if (new URL(page.url()).pathname.endsWith("/login")) {
    await ctx.close(); ctx = await browser.newContext({ acceptDownloads: true }); page = await ctx.newPage();
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.fill('input[name="email"]', email); await page.fill('input[name="password"]', PW);
    await Promise.all([page.waitForURL((u: URL) => !u.pathname.endsWith("/login"), { timeout: 45000 }).catch(() => {}), page.click('button:has-text("Sign in")')]);
  }
  await ctx.storageState({ path: AUTH });
  return { ctx, page };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const { ctx, page } = await ensureLogin(browser, "tlm");
  const errors: string[] = [];
  let intercepted = 0;
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message.slice(0, 200)));
  // Force the anchor-download fallback: the File System Access picker has no UI headless.
  await page.addInitScript(() => { try { delete (window as any).showSaveFilePicker; } catch {} });

  if (!DORMANT) {
    // Serve the m159 columns at the PostgREST boundary. Only the defensive
    // industrial select (identified by its column list) is intercepted —
    // every other production_task_lists request hits the live DB.
    await page.route("**/rest/v1/production_task_lists*", async (route) => {
      const url = decodeURIComponent(route.request().url());
      if (url.includes("solar_panel_tilt_angle")) {
        intercepted++;
        await route.fulfill({
          status: 200,
          contentType: "application/vnd.pgrst.object+json",
          body: JSON.stringify(M159_ROW),
        });
        return;
      }
      await route.fallback();
    });
  }

  await page.goto(`${BASE}/task-lists/${TL}`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(2500);
  const btn = page.locator('button:has-text("Generate Production PDF")').first();
  console.log(`mode=${DORMANT ? "DORMANT (live pre-m159 DB)" : "M159 simulated at PostgREST boundary"}`);
  console.log("Generate Production PDF button present:", await btn.count());

  let ok = false;
  const dlPromise = page.waitForEvent("download", { timeout: 90000 }).then(async (d) => { await d.saveAs(PDF); console.log("downloaded:", d.suggestedFilename()); ok = true; }).catch((e) => console.log("no download event:", String((e as Error).message).split("\n")[0]));
  await btn.click({ timeout: 8000 }).catch((e) => console.log("click err: " + e.message.split("\n")[0]));
  for (let i = 0; i < 60 && !ok; i++) await page.waitForTimeout(500);
  await dlPromise;
  await page.waitForTimeout(800);

  const feedback = await page.evaluate(() => {
    const p = [...document.querySelectorAll("p")].find((x) => /downloaded|Failed|Could not embed/.test(x.textContent || ""));
    return (p?.textContent || "").trim();
  });
  console.log("page feedback:", JSON.stringify(feedback));
  if (!DORMANT) console.log("industrial select intercepted:", intercepted, "time(s)");
  console.log("console errors (" + errors.length + "):");
  for (const e of errors.slice(0, 10)) console.log("  " + e);

  if (ok && fs.existsSync(PDF)) {
    console.log(`\nPDF saved: ${PDF} (${fs.statSync(PDF).size} bytes)`);
  } else {
    console.log("\nFAIL: no PDF captured");
    process.exitCode = 1;
  }
  await ctx.close(); await browser.close();
}
main().catch((e) => { console.error("pdf capture crashed:", e); process.exit(1); });
