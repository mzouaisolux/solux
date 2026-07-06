// Render PDF pages via Chromium's built-in viewer (install-free multipage).
//   node --experimental-strip-types e2e/audit/aospro-render-pdf.ts
import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";
const OUT = path.join("e2e", ".runs", "aospro");
const PDF = "file://" + path.resolve(OUT, "factory.pdf");

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 1600 } });
  const page = await ctx.newPage();
  for (const p of [1, 2]) {
    try {
      await page.goto(`${PDF}#page=${p}&zoom=125`, { waitUntil: "load", timeout: 20000 });
      await page.waitForTimeout(3500);
      await page.screenshot({ path: path.join(OUT, `pdfview-p${p}.png`) });
      console.log(`rendered page ${p}`);
    } catch (e) { console.log(`page ${p} err: ${String((e as Error).message).split("\n")[0]}`); }
  }
  // Report if the viewer actually loaded (embed present) vs blank.
  const hasEmbed = await page.evaluate(() => !!document.querySelector("embed,#plugin,pdf-viewer") || document.title.includes("pdf")).catch(() => false);
  console.log("viewer embed present:", hasEmbed, "title:", await page.title().catch(() => "?"));
  const sz = fs.existsSync(path.join(OUT, "pdfview-p2.png")) ? fs.statSync(path.join(OUT, "pdfview-p2.png")).size : 0;
  console.log("pdfview-p2.png bytes:", sz);
  await browser.close();
}
main().catch((e) => { console.error("render crashed:", e); process.exit(1); });
