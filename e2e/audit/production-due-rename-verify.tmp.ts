// =====================================================================
// TEMP VERIFY — "Current ETA" → "Production Due" rename (order detail).
// Real Operations session (storageState), real data, read-only.
// Proves: /production/orders/[id] no longer shows "Current ETA" /
// "Initial ETA" anywhere; the operations strip + Delay & timeline
// section show "Production Due" instead.
//
// Run (from ~/dev/facturation):
//   node --env-file=.env.e2e --experimental-strip-types \
//     e2e/audit/production-due-rename-verify.tmp.ts
// =====================================================================

import { chromium } from "@playwright/test";
import { BASE_URL, storageStatePath } from "../config.ts";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`  ✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main(): Promise<void> {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    storageState: storageStatePath("operation"),
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  console.log("[1] Find a production order (via /production/orders)");
  await page.goto(`${BASE_URL}/production/orders`, {
    waitUntil: "networkidle",
  });
  check("not bounced to /login", !page.url().includes("/login"), page.url());
  const href = await page
    .locator('a[href*="/production/orders/"]')
    .first()
    .getAttribute("href");
  check("found an order link", !!href, href ?? "none");
  if (!href) throw new Error("no production order to open");

  console.log(`[2] Open order detail ${href}`);
  await page.goto(`${BASE_URL.replace(/\/$/, "")}${href}`, {
    waitUntil: "networkidle",
  });
  const body = await page.locator("body").innerText();

  check(
    'no "Current ETA" anywhere on the page',
    !/current eta/i.test(body)
  );
  check(
    'no "Initial ETA" anywhere on the page',
    !/initial eta/i.test(body)
  );
  check(
    '"Production Due" visible (strip and/or Delay & timeline)',
    /production due/i.test(body)
  );

  // Operations strip: the 2nd KPI card is now "Production Due"
  const kpiLabels = await page.$$eval(".po-kpi .k", (els) =>
    els.map((el) => (el.textContent ?? "").trim())
  );
  check(
    "operations strip cards read Committed date · Production Due",
    kpiLabels[0] === "Committed date" && kpiLabels[1] === "Production Due",
    kpiLabels.join(" | ")
  );

  // Delay & timeline section: open it if collapsed, check the cell label
  const delaySection = page.locator("text=Delay & timeline").first();
  if (await delaySection.count()) {
    await delaySection.click().catch(() => {});
    await page.waitForTimeout(300);
    const body2 = await page.locator("body").innerText();
    check(
      'Delay & timeline shows "Production Due" or "Final deadline" cell',
      /production due|final deadline/i.test(body2)
    );
    check(
      'still no "Current ETA" after expanding Delay & timeline',
      !/current eta/i.test(body2)
    );
  }

  await page.screenshot({
    path: "e2e/.runs/production-due-rename.png",
    fullPage: false,
  });
  console.log("\nScreenshot: e2e/.runs/production-due-rename.png");
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
