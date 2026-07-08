// =====================================================================
// TEMP VERIFY — Quick Update UX redesign (Production Control Center).
// Real Operations session (storageState), real data, real saves.
// Proves: column order + terminology, sticky identity block, bare
// amounts + payment dot, keyboard grid nav (Enter/arrows/Escape),
// Saving…/✓ Saved indicator, and the notes edit round-trips the DB
// (reload shows the persisted value), then restores the original.
//
// Run (from ~/dev/facturation):
//   node --env-file=.env.e2e --experimental-strip-types \
//     e2e/audit/quick-update-redesign-verify.tmp.ts
// =====================================================================

import { chromium } from "@playwright/test";
import { BASE_URL, storageStatePath } from "../config.ts";

const EXPECTED_HEADERS = [
  "PO",
  "Client",
  "Sales",
  "Production Status",
  "Deposit",
  "Balance",
  "Production Due",
  "Factory Delay",
  "Carrier",
  "ETD",
  "ETA",
  "BL",
  "Shipping Documents",
  "Notes",
];

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

  console.log("[1] Load /production/quick-update as Operations");
  await page.goto(`${BASE_URL}/production/quick-update`, {
    waitUntil: "networkidle",
  });
  check("not bounced to /login", !page.url().includes("/login"), page.url());

  // fresh column layout (localStorage v2 — ensure defaults)
  await page.evaluate(() => {
    localStorage.removeItem("qu2:cols");
    localStorage.removeItem("qu2:widths");
  });
  await page.reload({ waitUntil: "networkidle" });

  console.log("[2] Column order + terminology");
  const headers = await page.$$eval("table thead th", (ths) =>
    ths.map((th) => (th.textContent ?? "").trim())
  );
  check(
    "header order = workflow order",
    JSON.stringify(headers) === JSON.stringify(EXPECTED_HEADERS),
    headers.join(" | ")
  );
  check(
    'no header says "Current ETA" / "Payment Status" / "Alert" by default',
    !headers.some((h) => /current eta|payment status|alert/i.test(h))
  );

  const rowCount = await page.locator("table tbody tr").count();
  check("orders rendered", rowCount > 0, `${rowCount} rows`);

  console.log("[3] Sticky identity block (PO/Client/Sales/Status)");
  const sticky = await page.$$eval("table thead th", (ths) =>
    ths.slice(0, 5).map((th) => {
      const cs = getComputedStyle(th);
      return { pos: cs.position, left: cs.left };
    })
  );
  check(
    "first 4 headers sticky with cumulative left offsets",
    sticky.slice(0, 4).every((s) => s.pos === "sticky") &&
      sticky[0].left === "0px" &&
      parseFloat(sticky[1].left) > 0 &&
      parseFloat(sticky[3].left) > parseFloat(sticky[2].left),
    sticky.map((s) => `${s.pos}@${s.left}`).join(", ")
  );
  // scroll the table right and confirm the PO cell stays on screen
  const firstPoBefore = await page
    .locator("table tbody tr")
    .first()
    .locator("td")
    .first()
    .boundingBox();
  await page.$eval("table", (t) => {
    (t.closest("div") as HTMLElement).scrollLeft = 600;
  });
  await page.waitForTimeout(150);
  const firstPoAfter = await page
    .locator("table tbody tr")
    .first()
    .locator("td")
    .first()
    .boundingBox();
  check(
    "PO column pinned during horizontal scroll",
    !!firstPoBefore &&
      !!firstPoAfter &&
      Math.abs(firstPoBefore.x - firstPoAfter.x) < 2,
    `x ${firstPoBefore?.x} → ${firstPoAfter?.x}`
  );
  await page.$eval("table", (t) => {
    (t.closest("div") as HTMLElement).scrollLeft = 0;
  });

  console.log("[4] Simplified amounts (no currency prefix, values visible)");
  const depositTexts = await page.$$eval(
    'table tbody tr [data-qcol="deposit"]',
    (els) => els.slice(0, 5).map((el) => (el.textContent ?? "").trim())
  );
  check(
    "deposit cells show bare amounts (no USD/EUR prefix)",
    depositTexts.length > 0 && depositTexts.every((t) => !/[A-Z]{3}\s/.test(t)),
    depositTexts.join(" · ")
  );
  const dotCount = await page
    .locator('table tbody tr:first-child [data-qcol="deposit"] span')
    .first()
    .count();
  check("payment dot indicator present", dotCount > 0);

  console.log("[5] Keyboard: Enter=down, ArrowUp=up, Escape=revert (no save)");
  const notes = page.locator('input[data-qcol="notes"]');
  const notesCount = await notes.count();
  check("notes column editable for Operations", notesCount > 0, `${notesCount} inputs`);

  if (notesCount >= 2) {
    await notes.nth(0).focus();
    await page.keyboard.press("Enter");
    const afterEnter = await page.evaluate(() =>
      document.activeElement?.getAttribute("data-qcol")
    );
    const rowIdx = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      const all = Array.from(
        document.querySelectorAll('input[data-qcol="notes"]')
      );
      return all.indexOf(el as HTMLInputElement);
    });
    check("Enter moves down within Notes column", afterEnter === "notes" && rowIdx === 1);
    await page.keyboard.press("ArrowUp");
    const rowIdx2 = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      const all = Array.from(
        document.querySelectorAll('input[data-qcol="notes"]')
      );
      return all.indexOf(el as HTMLInputElement);
    });
    check("ArrowUp moves back up", rowIdx2 === 0);
  }

  // Escape must revert without saving
  const n0 = notes.nth(0);
  const original = await n0.inputValue();
  await n0.focus();
  await n0.fill(original + " ESC-GARBAGE");
  await page.keyboard.press("Escape");
  const afterEsc = await n0.inputValue();
  check("Escape reverts the edit", afterEsc === original, `"${afterEsc}"`);
  const savingAfterEsc = await page
    .locator("text=Saving…")
    .count();
  check("Escape does not trigger a save", savingAfterEsc === 0);

  console.log("[6] Auto-save feedback + DB round-trip on Notes");
  const po = await page
    .locator("table tbody tr")
    .first()
    .locator("td")
    .first()
    .innerText();
  const stamp = `QU-verify ${Date.now()}`;
  await n0.focus();
  await n0.fill(stamp);
  await page.keyboard.press("Enter"); // blur → auto-save + move down
  // indicator: Saving… then ✓ Saved
  const sawSaved = await page
    .locator("span", { hasText: /^(Saving…|✓ Saved)$/ })
    .first()
    .waitFor({ state: "visible", timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  check("save indicator visible (Saving…/✓ Saved)", sawSaved);
  await page.waitForTimeout(1500);

  await page.reload({ waitUntil: "networkidle" });
  const persisted = await page
    .locator('input[data-qcol="notes"]')
    .nth(0)
    .inputValue();
  check(
    `notes round-trips the DB (order ${po.trim()})`,
    persisted === stamp,
    `"${persisted}"`
  );

  // restore original value
  const n0b = page.locator('input[data-qcol="notes"]').nth(0);
  await n0b.focus();
  await n0b.fill(original);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(2000);
  await page.reload({ waitUntil: "networkidle" });
  const restored = await page
    .locator('input[data-qcol="notes"]')
    .nth(0)
    .inputValue();
  check("original notes value restored", restored === original, `"${restored}"`);

  await page.screenshot({
    path: "e2e/.runs/quick-update-redesign.png",
    fullPage: false,
  });
  console.log("\nScreenshot: e2e/.runs/quick-update-redesign.png");
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
