// UI PROOF — la page /affairs/OIM affiche à nouveau les fichiers uploadés.
import { chromium, type Browser, type Page } from "playwright";

const BASE = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const OIM = "65755e17-6a3e-4bab-b658-e52c20f7e70b";

async function login(browser: Browser, role: string): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.fill('input[name="email"]', process.env[`E2E_${role.toUpperCase()}_EMAIL`] || "");
  await page.fill('input[name="password"]', process.env.E2E_PASSWORD || "");
  await Promise.all([
    page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 30000 }).catch(() => {}),
    page.click('button:has-text("Sign in")'),
  ]);
  return page;
}

const browser = await chromium.launch();
let ok = true;
try {
  const page = await login(browser, "admin");
  // retry once — dev cold compile
  for (let i = 0; i < 2; i++) {
    try {
      await page.goto(`${BASE}/affairs/${OIM}`, { waitUntil: "networkidle", timeout: 60000 });
      break;
    } catch {}
  }
  const text = await page.evaluate(() => (document.querySelector("main") || document.body).innerText);
  const expected = [
    "SP8MD-300X300X16-200X89X3.5-60X750-0-TZ251008041.pdf",
    "SOLUX I Fiche Technique I SSLX Perf 80-FR (Top).pdf",
    "Simulation energetique", // étude énergétique (lighting)
  ];
  for (const e of expected) {
    const hit = text.includes(e);
    console.log(`${hit ? "✓" : "✗"} page contient « ${e} »`);
    if (!hit) ok = false;
  }
} finally {
  await browser.close();
}
console.log(ok ? "\n✅ UI PASS" : "\n❌ UI FAIL");
process.exit(ok ? 0 : 1);
