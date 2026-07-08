// =====================================================================
// TEMP VERIFY — inline "+ New Project" fix. REAL testsales login (no View-As).
//  A. live client  → + New Project → Create → NO 500, affair selected;
//     reload → affair present in the server-loaded project list.
//  B. stale ?client= (deleted af45fbfe) → amber notice + unlocked selector,
//     no phantom lock, and no way to reach the FK 500.
//  C. DB post-check under the sales JWT (row really exists, right client).
// Run: node --env-file=.env.local --env-file=.env.e2e \
//        --experimental-strip-types e2e/audit/quickcreate-verify.tmp.ts
// =====================================================================
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const BASE = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PASSWORD = process.env.E2E_PASSWORD || "";
const EMAIL = process.env.E2E_SALES_EMAIL || "";
const LIVE_CLIENT_ID = "d6b411fb-b236-4302-92fc-03ff825cfe12"; // QA COCKPIT CLIENT 46594
const LIVE_CLIENT_NAME = "QA COCKPIT CLIENT 46594";
const DEAD_CLIENT_ID = "af45fbfe-dc02-491b-bb2f-8ba564243a92"; // deleted "Test 5 July QA"
const AFFAIR_NAME = `Affaire Versioning QA ${new Date().toISOString().slice(11, 19).replace(/:/g, "")}`;

let failures = 0;
function check(label: string, ok: boolean, extra = "") {
  console.log(`  ${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failures++;
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // --- real login ---
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 90000 }),
    page.click('button:has-text("Sign in")'),
  ]);
  console.log(`[verify] logged in as ${EMAIL} → ${page.url()}`);

  // --- capture every POST status on the builder ---
  const posts: { url: string; status: number }[] = [];
  page.on("response", (r) => {
    if (r.request().method() === "POST") posts.push({ url: r.url(), status: r.status() });
  });

  // ---------- A. live client: inline create must work ----------
  console.log(`\n[A] live client ${LIVE_CLIENT_NAME}`);
  await page.goto(`${BASE}/documents/new?client=${LIVE_CLIENT_ID}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector(`text=${LIVE_CLIENT_NAME}`, { timeout: 60000 });
  check("locked client renders its real name", true);
  await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});

  // First dev-mode load: DOM paints before hydration wires onClick — retry
  // the click until the modal actually opens.
  for (let i = 0; i < 4; i++) {
    await page.locator('button:has-text("+ New Project")').first().click();
    const opened = await page
      .waitForSelector("text=Create new project", { timeout: 4000 })
      .then(() => true)
      .catch(() => false);
    if (opened) break;
    await page.waitForTimeout(1500);
  }
  await page.waitForSelector('text=Create new project', { timeout: 15000 });
  await page.fill('input[placeholder*="SONABEL"]', AFFAIR_NAME);
  posts.length = 0;
  await page.getByRole("button", { name: "Create", exact: true }).click();
  // modal closes on success; error text appears inline on failure
  await page.waitForSelector("text=Create new project", { state: "detached", timeout: 20000 }).catch(() => {});
  const modalStillOpen = await page.locator("text=Create new project").count();
  const errText = modalStillOpen ? await page.locator(".text-rose-700").first().textContent().catch(() => "") : "";
  const badPosts = posts.filter((p) => p.status >= 400);
  check("POST returned no 4xx/5xx", badPosts.length === 0, badPosts.map((p) => `${p.status} ${p.url}`).join(", "));
  check("modal closed (no inline error)", !modalStillOpen, errText || "");
  const selectedCard = await page.locator(`text=${AFFAIR_NAME}`).count();
  check("new affair visible & selected in the builder", selectedCard > 0);

  // reload → server-side clientAffairs must now include it
  await page.goto(`${BASE}/documents/new?client=${LIVE_CLIENT_ID}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector(`text=${LIVE_CLIENT_NAME}`, { timeout: 60000 });
  await page.waitForTimeout(800);
  const afterReload = await page.locator(`text=${AFFAIR_NAME}`).count();
  check("affair appears in the project list after reload (server query)", afterReload > 0);

  // ---------- B. stale ?client= (deleted row) ----------
  console.log(`\n[B] stale client ${DEAD_CLIENT_ID.slice(0, 8)}… (deleted)`);
  posts.length = 0;
  await page.goto(`${BASE}/documents/new?client=${DEAD_CLIENT_ID}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector("text=no longer exists", { timeout: 60000 });
  check("stale-link notice shown", true);
  const phantomLock = await page.locator("text=Selected client").count();
  check("no phantom locked client", phantomLock === 0);
  // unlocked flow → the client picker (combobox) is available again
  const hasNewClientBtn = await page.locator('button:has-text("+ New client")').count();
  check("unlocked flow (+ New client button back)", hasNewClientBtn > 0);
  const badPostsB = posts.filter((p) => p.status >= 400);
  check("no failing POST on stale page load", badPostsB.length === 0);

  await browser.close();

  // ---------- C. DB post-check under the sales JWT ----------
  console.log(`\n[C] DB post-check`);
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: s } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  const { data: row, error } = await sb
    .from("affairs")
    .select("id, name, client_id, owner_id, status, source, description")
    .eq("name", AFFAIR_NAME)
    .maybeSingle();
  check("affair row exists in DB", !!row, error?.message);
  if (row) {
    check("client_id = live client", row.client_id === LIVE_CLIENT_ID, String(row.client_id));
    check("owner_id = testsales", row.owner_id === s?.user?.id, String(row.owner_id));
    check("status=lead, source=direct_request", row.status === "lead" && row.source === "direct_request", `${row.status}/${row.source}`);
  }
  await sb.auth.signOut();

  console.log(`\n[verify] ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
