// =====================================================================
// Manual verification — Event Registry opt-in polish (2026-07-03).
// Reuses the saved ADMIN storageState (no password needed) to load the
// registry, exercise the help popover + master toggle, and screenshot.
// Run: node --experimental-strip-types e2e/audit/verify-event-registry.ts
// =====================================================================

import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { BASE_URL, storageStatePath } from "../config.ts";

const OUT = "e2e/.runs/evt";

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({
    storageState: storageStatePath("admin"),
    viewport: { width: 1360, height: 1000 },
  });
  const page = await context.newPage();

  // ---- 1. Index ----------------------------------------------------
  await page.goto(`${BASE_URL}/admin/events`, { waitUntil: "networkidle" });
  const url = new URL(page.url());
  if (url.pathname.startsWith("/login")) {
    console.error("[verify] BOUNCED TO LOGIN — admin session expired. Re-run npm run e2e:bootstrap.");
    await browser.close();
    process.exit(2);
  }
  console.log(`[verify] index loaded @ ${page.url()}`);

  const tableMissing = await page.locator("text=/apply migration/i").count();
  console.log(`[verify] m136 tables missing banner: ${tableMissing > 0 ? "YES (m136 not applied)" : "no (tables present)"}`);

  const counts = {
    disabled: await page.locator(".evt-status-badge.off").count(),
    enabled: await page.locator(".evt-status-badge.on").count(),
    customized: await page.locator(".evt-status-badge.custom").count(),
    critTag: await page.locator(".evt-tag-crit").count(),
    helpIcons: await page.locator(".evt-help-btn").count(),
  };
  console.log("[verify] badges:", JSON.stringify(counts));

  await page.screenshot({ path: `${OUT}/1-index.png`, fullPage: true });

  // ---- 2. Help popover on hover -----------------------------------
  const firstHelp = page.locator(".evt-help-btn").first();
  await firstHelp.hover();
  await page.waitForTimeout(250);
  const popText = await page.locator(".evt-help-pop").first().innerText().catch(() => "");
  const hasWhen = /When does this happen/i.test(popText);
  const hasWhy = /Why would someone care/i.test(popText);
  const hasRecip = /Typical recipients/i.test(popText);
  console.log(`[verify] help popover — when:${hasWhen} why:${hasWhy} recipients:${hasRecip}`);
  await page.screenshot({ path: `${OUT}/2-help-popover.png` });

  // ---- 3. Detail page: master toggle reveals routing ---------------
  await page.goto(`${BASE_URL}/admin/events/po.created`, { waitUntil: "networkidle" });
  console.log(`[verify] detail loaded @ ${page.url()}`);

  const gridBefore = await page.locator(".evt-notif-grid").count();
  const collapsed = await page.locator(".evt-master-collapsed").count();
  console.log(`[verify] disabled state — routing grid visible:${gridBefore > 0} collapsed-hint:${collapsed > 0}`);
  await page.screenshot({ path: `${OUT}/3-detail-disabled.png`, fullPage: true });

  // Toggle the master switch ON
  await page.locator('input[name="notify_enabled"]').check();
  await page.waitForTimeout(200);
  const gridAfter = await page.locator(".evt-notif-grid").count();
  const recipients = await page.locator(".evt-notif-role").count();
  console.log(`[verify] after enable — routing grid visible:${gridAfter > 0} recipient selects:${recipients}`);
  await page.screenshot({ path: `${OUT}/4-detail-enabled.png`, fullPage: true });

  await browser.close();

  const ok =
    hasWhen && hasWhy && hasRecip &&
    counts.helpIcons > 50 &&
    gridBefore === 0 && collapsed > 0 &&
    gridAfter > 0 && recipients >= 6;
  console.log(`\n[verify] VERDICT: ${ok ? "PASS ✓" : "CHECK screenshots — some assertion soft-failed"}`);
}

main().catch((e) => {
  console.error("[verify] crashed:", e);
  process.exit(1);
});
