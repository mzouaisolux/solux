// =====================================================================
// m142 real-session proof — catalogue prices hidden/visible per role.
//   node --env-file=.env.e2e --experimental-strip-types \
//     e2e/audit/hide-prices-test.ts <role> <expect-visible|expect-hidden|expect-admin>
//
// Real login (true role JWT, NOT View-As). Opens /documents/new, picks the
// first catalogue product, then asserts the price surfaces:
//   expect-visible : tier buttons + standard price shown (flag OFF baseline)
//   expect-hidden  : no Tier block, manual unit-price input, no "No price
//                    found" alert, tierPrices EMPTY in the server payload
//   expect-admin   : tier buttons + amber "hidden for sales" banner +
//                    "visible admin only" badge (flag ON, exempt user)
// =====================================================================
import { chromium, type Page } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PASSWORD = process.env.E2E_PASSWORD || "";
const role = (process.argv[2] || "sales").toLowerCase();
const mode = process.argv[3] || "expect-visible";
const email = process.env[`E2E_${role.toUpperCase()}_EMAIL`] || "";
const AUTH = path.join("e2e", ".auth", `${role}.json`);
const OUT = path.join("e2e", ".runs", "hide-prices");
fs.mkdirSync(OUT, { recursive: true });

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ✅" : "  ❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main() {
  const browser = await chromium.launch();
  let ctx = await browser.newContext(fs.existsSync(AUTH) ? { storageState: AUTH } : {});
  let page: Page = await ctx.newPage();
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(400);
  if (new URL(page.url()).pathname.endsWith("/login")) {
    await ctx.close();
    ctx = await browser.newContext();
    page = await ctx.newPage();
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', PASSWORD);
    await Promise.all([
      page.waitForURL((u: URL) => !u.pathname.endsWith("/login"), { timeout: 45000 }).catch(() => {}),
      page.click('button:has-text("Sign in")'),
    ]);
    await ctx.storageState({ path: AUTH });
  }
  console.log(`▶ ${role} (${email}) — ${mode}`);

  // Raw server payload BEFORE any client hydration effects: what the browser
  // actually received. tierPrices is a serialized client-component prop.
  const resp = await page.goto(`${BASE}/documents/new`, { waitUntil: "domcontentloaded", timeout: 60000 });
  const rawHtml = (await resp?.text()) ?? "";
  await page.waitForSelector("main", { timeout: 30000 });
  await page.waitForTimeout(1200);

  // Pick the first catalogue product (fresh line opens the picker directly).
  const card = page.locator("main .grid button.block").first();
  await card.waitFor({ timeout: 20000 });
  await card.click();
  await page.waitForTimeout(800);

  const mainText = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  const tierVisible = await page
    .locator("main button", { hasText: /^(high|medium|low)$/ })
    .first()
    .isVisible()
    .catch(() => false);
  const manualInput = await page
    .locator('main input[type="number"][step="0.01"]')
    .first()
    .isVisible()
    .catch(() => false);
  const noPriceAlert = mainText.includes("No price found for this product");
  const adminBanner = mainText.includes("Catalogue prices are hidden for sales");
  const adminBadge = mainText.includes("visible admin only");
  const sourceToggle = await page
    .locator("main button", { hasText: /^Auto$/ })
    .first()
    .isVisible()
    .catch(() => false);
  // Server payload: non-empty tier price map looks like tierPrices":{"<uuid>":
  const payloadHasPrices = /tierPrices\\?":\s*\{\\?"/.test(rawHtml);
  const payloadEmpty = /tierPrices\\?":\s*\{\}/.test(rawHtml);

  if (mode === "expect-hidden") {
    check("Tier (high/medium/low) absent", !tierVisible);
    check("saisie manuelle du prix présente", manualInput);
    check("aucune alerte 'No price found'", !noPriceAlert);
    check("toggle Auto/Manual absent", !sourceToggle);
    check("bannière price-list absente", !mainText.includes("price list"), "");
    check("payload serveur: tierPrices vide", payloadEmpty && !payloadHasPrices,
      `empty=${payloadEmpty} hasPrices=${payloadHasPrices}`);
  } else if (mode === "expect-admin") {
    check("Tier (high/medium/low) visible", tierVisible);
    check("bannière 'hidden for sales' visible", adminBanner);
    check("badge 'visible admin only' visible", adminBadge);
    check("payload serveur: tierPrices renseigné", payloadHasPrices);
  } else {
    check("Tier (high/medium/low) visible", tierVisible);
    check("aucune bannière admin-override", !adminBanner);
    check("aucun badge 'visible admin only'", !adminBadge);
    check("payload serveur: tierPrices renseigné", payloadHasPrices);
  }

  await page.screenshot({ path: path.join(OUT, `${role}-${mode}.png`), fullPage: false });
  console.log(`  📸 ${path.join(OUT, `${role}-${mode}.png`)}`);
  await browser.close();
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
