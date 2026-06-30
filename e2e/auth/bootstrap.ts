// =====================================================================
// E2E auth bootstrap — logs in the 6 REAL accounts through the REAL
// /login form and saves one storageState per role to e2e/.auth/<role>.json.
// Then VALIDATES each saved state by loading a protected page and asserting
// it is NOT bounced to /login. Fails (exit 1) if any account is broken.
//
// Run:  npm run e2e:bootstrap   (needs the dev server up on :3000)
// See docs/PLAN_E2E_HARNESS.md §4 (Lot 2b).
// =====================================================================

import { chromium, type Browser } from "@playwright/test";
import { mkdir, rm } from "node:fs/promises";
import {
  ROLES,
  BASE_URL,
  AUTH_DIR,
  storageStatePath,
  type RoleAccount,
} from "../config.ts";
import { env } from "../env.ts";

const LOGIN_TIMEOUT = 30_000;

interface RoleResult {
  label: string;
  email: string;
  loggedIn: boolean;
  validated: boolean;
  error?: string;
}

// Log in via the real form and persist the session cookies.
async function login(browser: Browser, account: RoleAccount): Promise<void> {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
    await page.fill('input[name="email"]', account.email);
    await page.fill('input[name="password"]', env.password);
    // The server action redirects to /dashboard on success, or back to
    // /login?error=... on failure (which would time out here = a real failure).
    await Promise.all([
      page.waitForURL((u) => !u.pathname.startsWith("/login"), {
        timeout: LOGIN_TIMEOUT,
      }),
      page.click('button:has-text("Sign in")'),
    ]);
    await context.storageState({ path: storageStatePath(account.role) });
  } finally {
    await context.close();
  }
}

// Reload the saved state in a fresh context and confirm it is authenticated.
async function validate(browser: Browser, account: RoleAccount): Promise<boolean> {
  const context = await browser.newContext({
    storageState: storageStatePath(account.role),
  });
  const page = await context.newPage();
  try {
    await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "domcontentloaded" });
    return !new URL(page.url()).pathname.startsWith("/login");
  } finally {
    await context.close();
  }
}

async function main(): Promise<void> {
  console.log(`[e2e] bootstrap → ${ROLES.length} accounts @ ${BASE_URL}`);
  console.log(`[e2e] storageStates → ${AUTH_DIR}\n`);

  await rm(AUTH_DIR, { recursive: true, force: true });
  await mkdir(AUTH_DIR, { recursive: true });

  const browser = await chromium.launch();
  const results: RoleResult[] = [];
  try {
    for (const account of ROLES) {
      const r: RoleResult = {
        label: account.label,
        email: account.email,
        loggedIn: false,
        validated: false,
      };
      try {
        await login(browser, account);
        r.loggedIn = true;
        r.validated = await validate(browser, account);
      } catch (e) {
        r.error = e instanceof Error ? e.message.split("\n")[0] : String(e);
      }
      results.push(r);
      const ok = r.loggedIn && r.validated;
      console.log(
        `  [${ok ? "OK  " : "FAIL"}] ${account.label.padEnd(22)} ${account.email}` +
          (r.error ? `  — ${r.error}` : ""),
      );
    }
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !(r.loggedIn && r.validated));
  console.log(
    `\n[e2e] ${results.length - failed.length}/${results.length} sessions ready.`,
  );
  if (failed.length > 0) {
    console.error(`[e2e] FAILED: ${failed.map((f) => f.label).join(", ")}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("[e2e] bootstrap crashed:", e);
  process.exit(1);
});
