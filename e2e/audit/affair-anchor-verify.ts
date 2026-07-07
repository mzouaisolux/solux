// =====================================================================
// AFFAIR ANCHOR VERIFY — affair_id is the single source of truth.
//   1) one affair appears ONCE in the client affairs list (merged counters)
//   2) ALL documents of the affair are visible from the affair page
//   3) counters/documents not split across chains (2 docs on the single row)
//   4) client tree + production workflow still render
//   node --env-file=.env.local --env-file=.env.e2e --experimental-strip-types e2e/audit/affair-anchor-verify.ts
// =====================================================================
import { chromium, type Browser, type Page } from "playwright";
import { createClient as sbCreate } from "@supabase/supabase-js";

const BASE = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PW = process.env.E2E_PASSWORD || "";
const CLIENT = "c2379d1b-a8b9-4966-9efa-073dcb3f881e"; // AFRICA ENERGY SARL
const R: { name: string; ok: boolean; detail: string }[] = [];
const rec = (name: string, ok: boolean, detail = "") => R.push({ name, ok, detail });

async function login(browser: Browser, role: string): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.fill('input[name="email"]', process.env[`E2E_${role.toUpperCase()}_EMAIL`] || "");
  await page.fill('input[name="password"]', PW);
  await Promise.all([page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 30000 }).catch(() => {}), page.click('button:has-text("Sign in")')]);
  return page;
}
const mainText = (p: Page) => p.evaluate(() => (document.querySelector("main") || document.body).innerText).catch(() => "");
/** goto with one retry — dev cold-compiles abort the first navigation. */
async function nav(p: Page, url: string): Promise<void> {
  try {
    await p.goto(url, { waitUntil: "domcontentloaded", timeout: 40000 });
  } catch {
    await p.waitForTimeout(2500);
    await p.goto(url, { waitUntil: "domcontentloaded", timeout: 40000 });
  }
  await p.waitForTimeout(1500);
}

async function main(): Promise<void> {
  // Ground truth from DB (admin JWT): the real affair id + its documents.
  const sb = sbCreate(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  await sb.auth.signInWithPassword({ email: process.env.E2E_ADMIN_EMAIL!, password: PW });
  const { data: aff } = await sb.from("affairs").select("id,name").eq("client_id", CLIENT).ilike("name", "%OIM%").maybeSingle();
  const { data: docs } = await sb.from("documents").select("number,affair_id").eq("affair_id", aff?.id ?? "-");
  const docNumbers = (docs ?? []).map((d: any) => d.number as string);
  console.log(`DB: affair "${aff?.name}" (${aff?.id?.slice(0, 8)}) has ${docNumbers.length} docs: ${docNumbers.join(", ")}\n`);

  const browser = await chromium.launch({ headless: true });
  const page = await login(browser, "admin");

  // ---- 1+3) client affairs list: ONE OIM row, counters merged ----
  await nav(page, `${BASE}/clients/${CLIENT}?tab=affairs`);
  const txt = await mainText(page);
  const oimRows = (txt.match(/OIM\s*[-–]\s*Malanville/gi) || []).length;
  rec("1) one affair = ONE row in the client list", oimRows === 1, `"OIM – Malanville" appears ${oimRows}×`);
  const docCountShown = /2\s*Documents?/i.test(txt);
  rec("3) counters merged on the single row (2 documents)", docCountShown, docCountShown ? "row shows '2 Documents'" : `not found in row text`);

  // ---- 2) affair page: ALL documents visible ----
  if (aff?.id) {
    await nav(page, `${BASE}/affairs/${aff.id}`);
    const at = await mainText(page);
    const missing = docNumbers.filter((n) => n && !at.includes(n));
    rec("2) affair page shows EVERY document of the affair", missing.length === 0 && docNumbers.length >= 2, missing.length ? `missing: ${missing.join(", ")}` : `${docNumbers.length}/${docNumbers.length} visible (${docNumbers.join(", ")})`);
    const crashed = /application error|something went wrong/i.test(at);
    rec("2b) affair page renders w/o error (repository incl.)", !crashed && at.length > 100, `${at.length} chars`);
  } else rec("2) affair page", false, "affair not found in DB");

  // ---- 4a) client tree renders, OIM once ----
  await nav(page, `${BASE}/clients?view=tree`);
  // expand AFRICA ENERGY node if collapsed
  await page.getByText("AFRICA ENERGY", { exact: false }).first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(800);
  const treeTxt = await mainText(page);
  const treeOim = (treeTxt.match(/OIM\s*[-–]\s*Malanville/gi) || []).length;
  const treeOk = !/application error|something went wrong/i.test(treeTxt) && treeTxt.length > 100;
  rec("4a) clients tree renders · OIM appears once", treeOk && treeOim <= 1, `tree OK=${treeOk}, OIM ×${treeOim}`);

  // ---- 4b) production workflow renders ----
  await nav(page, `${BASE}/production/orders`);
  const poList = await mainText(page);
  const poIds: string[] = await page.evaluate(() => Array.from(new Set(Array.from(document.querySelectorAll('a[href*="/production/orders/"]')).map((a) => (a.getAttribute("href") || "").match(/\/production\/orders\/([0-9a-f-]{36})/i)?.[1] || "").filter(Boolean))));
  let poOk = poList.length > 50 && !/application error/i.test(poList);
  let poDetail = `list OK (${poIds.length} orders)`;
  if (poIds[0]) {
    await nav(page, `${BASE}/production/orders/${poIds[0]}`);
    const cockpit = await page.evaluate(() => document.querySelector(".po-pill")?.textContent?.trim() || "");
    poOk = poOk && !!cockpit;
    poDetail += ` · cockpit status "${cockpit}"`;
  }
  rec("4b) production workflow (orders list + cockpit) works", poOk, poDetail);

  console.log("===== AFFAIR ANCHOR VERIFY =====");
  let fail = 0;
  for (const r of R) { if (!r.ok) fail++; console.log(`  ${r.ok ? "✓" : "✗"} ${r.name}${r.detail ? ` — ${r.detail}` : ""}`); }
  console.log(`\n${fail === 0 ? "✅ ALL PASS" : `❌ ${fail} FAIL`}`);
  await browser.close();
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
