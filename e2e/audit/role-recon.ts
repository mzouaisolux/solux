// =====================================================================
// AUDIT — per-role route access recon (READ-ONLY: only navigations).
// Loads each role's validated storageState (e2e/.auth/<role>.json) and
// probes a curated set of routes (allowed + cross-role forbidden),
// recording for each: final URL (redirect?), HTTP status, whether an
// access-denied marker rendered, the <h1>, and a body snippet. Also
// captures the visible top nav per role. No data is mutated.
//
// Run:
//   node --env-file=.env.e2e --experimental-strip-types e2e/audit/role-recon.ts
// =====================================================================

import { chromium, type Browser, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ROLES, BASE_URL, storageStatePath } from "../config.ts";

// route → human label. Mix of each role's home turf and pages they must NOT reach.
const ROUTES: [string, string][] = [
  ["/dashboard", "Dashboard"],
  ["/clients", "Clients"],
  ["/task-lists", "Task lists"],
  ["/operations", "Orders/Operations"],
  ["/finance", "Finance cockpit (finance.view)"],
  ["/factory-mapping", "Factory mapping (factory_mapping.access)"],
  ["/cost-entry", "Cost entry (pricing.manage_costs/finance)"],
  ["/forecast", "Forecast"],
  ["/business", "Business overview"],
  ["/prospects", "Prospects/Tenders (prospect.access)"],
  ["/projects/approvals", "Project approvals (project.approve)"],
  ["/admin/products", "Admin · Products"],
  ["/admin/pricing", "Admin · Pricing (pricing.manage)"],
  ["/admin/users", "Admin · Users (admin.manage_users)"],
  ["/permissions/actions", "Permissions matrix (admin.manage_permissions)"],
  ["/admin/diagnostics", "Admin · Diagnostics (admin.diagnostics)"],
];

const DENY_MARKERS = [
  "access denied",
  "accès refusé",
  "not authorized",
  "missing required capability",
  "don't have permission",
  "do not have permission",
  "you don't have access",
  "permission requise",
  "forbidden",
];

interface Probe {
  label: string;
  requested: string;
  final: string;
  status: number | null;
  verdict: "ALLOWED" | "DENIED" | "BOUNCED" | "ERROR";
  bouncedTo: string | null;
  h1: string;
  snippet: string;
}

async function probe(page: Page, route: string, label: string): Promise<Probe> {
  let status: number | null = null;
  let errored = false;
  try {
    const resp = await page.goto(`${BASE_URL}${route}`, {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });
    status = resp ? resp.status() : null;
  } catch {
    errored = true;
  }
  await page.waitForTimeout(450); // let client-side redirect/render settle

  const final = new URL(page.url()).pathname;
  let bodyText = "";
  try {
    bodyText = (await page.evaluate(() => document.body?.innerText || "")).trim();
  } catch {
    /* page navigating */
  }
  const lower = bodyText.toLowerCase();
  const denied = DENY_MARKERS.some((d) => lower.includes(d));
  const onRoute = final === route || final.startsWith(route + "/");
  const bounced = !onRoute;

  let h1 = "";
  try {
    h1 = (await page.locator("h1").first().innerText({ timeout: 800 })).trim();
  } catch {
    /* no h1 */
  }

  let verdict: Probe["verdict"];
  if (errored) verdict = "ERROR";
  else if (bounced) verdict = "BOUNCED";
  else if (denied) verdict = "DENIED";
  else verdict = "ALLOWED";

  return {
    label,
    requested: route,
    final,
    status,
    verdict,
    bouncedTo: bounced ? final : null,
    h1: h1.replace(/\s+/g, " ").slice(0, 80),
    snippet: bodyText.replace(/\s+/g, " ").slice(0, 160),
  };
}

async function captureNav(page: Page): Promise<string> {
  try {
    await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(600);
    const txt = await page.evaluate(() => {
      const el =
        document.querySelector("header") ||
        document.querySelector("nav") ||
        document.body;
      return (el as HTMLElement)?.innerText || "";
    });
    return txt.replace(/\s+/g, " ").trim().slice(0, 500);
  } catch {
    return "(nav capture failed)";
  }
}

async function main(): Promise<void> {
  const OUT_DIR = path.join(process.cwd(), "e2e", ".runs", "audit");
  await mkdir(OUT_DIR, { recursive: true });

  console.log(`[audit] per-role route recon @ ${BASE_URL}\n`);
  const browser: Browser = await chromium.launch();
  const results: Record<string, unknown> = {};

  try {
    for (const acct of ROLES) {
      const context = await browser.newContext({
        storageState: storageStatePath(acct.role),
      });
      const page = await context.newPage();

      const nav = await captureNav(page);
      const sessionAlive = !nav.toLowerCase().includes("sign in");

      const probes: Probe[] = [];
      for (const [route, label] of ROUTES) {
        probes.push(await probe(page, route, label));
      }
      results[acct.role] = { label: acct.label, email: acct.email, nav, probes };

      console.log(`\n========== ${acct.label} — ${acct.email} ==========`);
      console.log(`session: ${sessionAlive ? "alive" : "DEAD (bounced to login)"}`);
      console.log(`nav: ${nav}\n`);
      for (const p of probes) {
        const tag =
          p.verdict === "ALLOWED"
            ? "ALLOWED"
            : p.verdict === "DENIED"
              ? "DENIED "
              : p.verdict === "BOUNCED"
                ? "BOUNCED"
                : "ERROR  ";
        const extra =
          p.verdict === "BOUNCED"
            ? `→ ${p.bouncedTo}`
            : p.verdict === "ALLOWED"
              ? `h1="${p.h1}"`
              : `h1="${p.h1}" | ${p.snippet.slice(0, 70)}`;
        console.log(
          `  [${tag}] ${p.requested.padEnd(22)} (${String(p.status).padStart(3)}) ${extra}`,
        );
      }

      await context.close();
    }
  } finally {
    await browser.close();
  }

  const outFile = path.join(OUT_DIR, "role-recon.json");
  await writeFile(outFile, JSON.stringify(results, null, 2), "utf8");
  console.log(`\n[audit] wrote ${outFile}`);
}

main().catch((e) => {
  console.error("[audit] role-recon crashed:", e);
  process.exit(1);
});
