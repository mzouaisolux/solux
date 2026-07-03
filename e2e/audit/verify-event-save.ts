// =====================================================================
// Save round-trip — enable an event, confirm it PERSISTS + shows on the
// index, then RESET it so the test DB stays "all disabled" for the owner.
// Non-destructive: cleans up in a finally block.
// Run: node --env-file=.env.e2e --experimental-strip-types e2e/audit/verify-event-save.ts
// =====================================================================

import { chromium } from "@playwright/test";
import { BASE_URL, storageStatePath } from "../config.ts";

const KEY = "po.created";

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    storageState: storageStatePath("admin"),
    viewport: { width: 1360, height: 1000 },
  });
  const page = await context.newPage();
  page.on("dialog", (d) => d.accept()); // auto-accept reset confirm

  let persisted = false;
  let indexEnabled = false;
  try {
    // ---- enable + save ----
    await page.goto(`${BASE_URL}/admin/events/${KEY}`, { waitUntil: "networkidle" });
    await page.locator('input[name="notify_enabled"]').check();
    await Promise.all([
      page.waitForURL(/saved=1/, { timeout: 20_000 }),
      page.locator("button.evt-save-btn").click(),
    ]);
    // after redirect the server re-reads the DB; the master row must exist
    const enabledBadge = await page.locator(".evt-master-state.on").count();
    persisted = enabledBadge > 0;
    console.log(`[save] after save — master shows Enabled: ${persisted}`);

    // ---- index reflects it ----
    await page.goto(`${BASE_URL}/admin/events`, { waitUntil: "networkidle" });
    // find the row for KEY and read its status badge class
    const row = page.locator(`tr:has(.evt-key:text-is("${KEY}"))`);
    indexEnabled = (await row.locator(".evt-status-badge.on").count()) > 0;
    const enabledCount = await page.locator(".evt-status-badge.on").count();
    console.log(`[save] index — ${KEY} shows Enabled: ${indexEnabled} (total enabled now: ${enabledCount})`);
  } finally {
    // ---- CLEANUP: reset back to disabled ----
    await page.goto(`${BASE_URL}/admin/events/${KEY}`, { waitUntil: "networkidle" });
    const hasReset = await page.locator(".evt-reset-btn:not([disabled])").count();
    if (hasReset > 0) {
      await Promise.all([
        page.waitForURL(/reset=1/, { timeout: 20_000 }).catch(() => {}),
        page.locator(".evt-reset-btn").click(),
      ]);
    }
    await page.goto(`${BASE_URL}/admin/events`, { waitUntil: "networkidle" });
    const stillEnabled = await page.locator(".evt-status-badge.on").count();
    console.log(`[save] CLEANUP — enabled events remaining: ${stillEnabled} (expected 0)`);
    await browser.close();

    const ok = persisted && indexEnabled && stillEnabled === 0;
    console.log(`\n[save] VERDICT: ${ok ? "PASS ✓ (save persists, index reflects, cleanup restored all-disabled)" : "CHECK — see logs"}`);
    process.exit(ok ? 0 : 1);
  }
}

main().catch((e) => {
  console.error("[save] crashed:", e);
  process.exit(1);
});
