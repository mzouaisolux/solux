// TLM Factory Mapping: enter Chinese factory instructions for the 5 AOSPRO+
// options selected by Sales, then Save. Filters by "AOSPRO" to avoid
// cross-category option-value collisions.
//   node --env-file=.env.local --env-file=.env.e2e --experimental-strip-types e2e/audit/aospro-fm-fill.ts
import { chromium, type Page } from "playwright";
import fs from "node:fs";
import path from "node:path";
const BASE = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PW = process.env.E2E_PASSWORD || "";
const OUT = path.join("e2e", ".runs", "aospro");

// 5 of the 7 requested Chinese strings go into factory instructions;
// the other two (备注 / 包装要求) go into task-list notes at validation time.
const MAP = [
  { val: "18V/105W", instr: "产品型号：AOS PRO Plus 测试（太阳能板 18V/105W）", code: "TY-105W" },
  { val: "538Wh",    instr: "电池盒：铝合金电池盒（538Wh 磷酸铁锂）",           code: "DC-538"  },
  { val: "T35",      instr: "控制器设置：智能调光模式（光学配光 T35）",          code: "OP-T35"  },
  { val: "4000k",    instr: "灯体颜色：深灰色（色温 4000K 中性白）",             code: "CCT-4000"},
  { val: "76mm",     instr: "工厂说明：请按照生产图纸确认所有配件（卡口 Ø76mm）", code: "SP-76"   },
];

async function ensureLogin(browser: any, role: string): Promise<Page> {
  const email = process.env[`E2E_${role.toUpperCase()}_EMAIL`] || "";
  const AUTH = path.join("e2e", ".auth", `${role}.json`);
  let ctx = await browser.newContext(fs.existsSync(AUTH) ? { storageState: AUTH } : {});
  let page = await ctx.newPage();
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(700);
  if (new URL(page.url()).pathname.endsWith("/login")) {
    await ctx.close(); ctx = await browser.newContext(); page = await ctx.newPage();
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.fill('input[name="email"]', email); await page.fill('input[name="password"]', PW);
    await Promise.all([page.waitForURL((u: URL) => !u.pathname.endsWith("/login"), { timeout: 45000 }).catch(() => {}), page.click('button:has-text("Sign in")')]);
  }
  await ctx.storageState({ path: AUTH });
  return page;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await ensureLogin(browser, "tlm");
  await page.goto(`${BASE}/factory-mapping`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(2500);

  // Narrow to the AOSPRO+ family so option values are unique.
  const search = page.locator('input[placeholder*="family" i]').first();
  await search.fill("AOSPRO");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, "fmfill-01-filtered.png"), fullPage: true });

  for (const m of MAP) {
    // Count matching rows after filtering (should be exactly 1).
    const rows = page.locator(`tr:has-text("${m.val}")`);
    const n = await rows.count();
    const instr = rows.first().locator('input[placeholder="Factory instruction…"]');
    const code = rows.first().locator('input[placeholder="Code"]');
    if (await instr.count()) {
      await instr.first().fill(m.instr);
      await code.first().fill(m.code).catch(() => {});
      console.log(`✓ ${m.val}: rows=${n} → filled instruction (len ${m.instr.length}) + code ${m.code}`);
    } else {
      console.log(`✗ ${m.val}: rows=${n} — no instruction input found`);
    }
    await page.waitForTimeout(200);
  }
  await page.screenshot({ path: path.join(OUT, "fmfill-02-filled.png"), fullPage: true });

  // Save.
  await page.locator('button:has-text("Save mappings")').first().click({ timeout: 8000 }).catch((e) => console.log("Save click err: " + e.message.split("\n")[0]));
  await page.waitForTimeout(3500);
  // Confirm dialog if any.
  await page.getByRole("button", { name: "Save", exact: false }).last().click({ timeout: 2500 }).catch(() => {});
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, "fmfill-03-saved.png"), fullPage: true });
  const bodyText = await page.evaluate(() => (document.querySelector("main") || document.body).innerText);
  console.log("saved? page mentions:", ["Saved", "saved", "Save mappings", "No changes"].filter((s) => bodyText.includes(s)).join(", "));
  await browser.close();
}
main().catch((e) => { console.error("fm-fill crashed:", e); process.exit(1); });
