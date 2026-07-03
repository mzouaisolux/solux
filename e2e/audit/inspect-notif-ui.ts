// =====================================================================
// Runtime notification INSPECTION via the real UI. Reuses saved role
// storageStates, reads exactly what each user sees in the bell, and
// classifies each bell item by its SOURCE (event-push vs review vs note),
// so we can prove the opt-in gate suppresses event-push while naming the
// non-gated signals. Screenshots feed + dashboard too.
// Run: node --env-file=.env.e2e --experimental-strip-types e2e/audit/inspect-notif-ui.ts
// =====================================================================

import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { BASE_URL, storageStatePath, type E2ERole } from "../config.ts";

const OUT = "e2e/.runs/notif";
const ROLES: E2ERole[] = ["admin", "operation", "director"];

async function inspectRole(browser: any, role: E2ERole) {
  const context = await browser.newContext({
    storageState: storageStatePath(role),
    viewport: { width: 1360, height: 1000 },
  });
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "networkidle" });
  if (new URL(page.url()).pathname.startsWith("/login")) {
    console.log(`  [${role}] SESSION EXPIRED — skipping`);
    await context.close();
    return;
  }

  // --- bell ---
  const badge = await page.locator(".sx-bell .sx-bdg").innerText().catch(() => "0");
  await page.locator(".sx-bell").click().catch(() => {});
  await page.waitForTimeout(400);
  const items = await page.locator(".sx-noti-item").all();
  console.log(`\n  [${role}] bell badge = ${badge};  drawer items = ${items.length}`);
  let eventPush = 0, review = 0, note = 0, other = 0;
  for (const it of items) {
    const ref = (await it.locator(".rid").innerText().catch(() => "")).replace(/\s+/g, " ").trim();
    const tag = (await it.locator(".sx-nitag").innerText().catch(() => "")).trim();
    const title = (await it.locator(".sx-nititle").innerText().catch(() => "")).replace(/\s+/g, " ").trim();
    let source = "event-push";
    if (/awaiting your review/i.test(ref)) { source = "REVIEW-prompt"; review++; }
    else if (/^Note/i.test(title)) { source = "NOTE-thread"; note++; }
    else if (tag === "Reply") { source = "comment/reply"; other++; }
    else { eventPush++; }
    console.log(`      • [${tag}] ${ref} — ${title.slice(0, 60)}  ⇒ ${source}`);
  }
  console.log(`  [${role}] classified: event-push=${eventPush} (MUST be 0 under opt-in), review=${review}, note=${note}, other=${other}`);
  await page.screenshot({ path: `${OUT}/${role}-bell.png` }).catch(() => {});

  // --- feed ---
  await page.goto(`${BASE_URL}/operations`, { waitUntil: "networkidle" }).catch(() => {});
  await page.screenshot({ path: `${OUT}/${role}-operations-feed.png`, fullPage: true }).catch(() => {});

  // --- dashboard ---
  await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "networkidle" }).catch(() => {});
  await page.screenshot({ path: `${OUT}/${role}-dashboard.png`, fullPage: true }).catch(() => {});

  await context.close();
  return { role, badge, eventPush, review, note, other };
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  console.log("=== BELL SOURCE CLASSIFICATION (event-push must be 0 with all events disabled) ===");
  for (const role of ROLES) {
    await inspectRole(browser, role).catch((e) => console.log(`  [${role}] error: ${e.message}`));
  }
  await browser.close();
  console.log("\n[inspect-ui] done. Screenshots in", OUT);
}

main().catch((e) => { console.error(e); process.exit(1); });
