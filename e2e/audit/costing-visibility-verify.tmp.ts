// =====================================================================
// VERIFY — confidentialité du costing Excel dans l'onglet Documents de
// l'affaire : visible pour admin (view_cost), INVISIBLE pour sales.
// Round-trip réel : upload+row 'costing' → /affairs/OIM (2 rôles) → cleanup.
// =====================================================================
import { chromium, type Browser } from "playwright";
import { createClient } from "@supabase/supabase-js";

const BASE = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const OIM = "65755e17-6a3e-4bab-b658-e52c20f7e70b";
const FNAME = "costing-visibility-check.xlsx";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
await admin.auth.signInWithPassword({ email: process.env.E2E_ADMIN_EMAIL!, password: process.env.E2E_PASSWORD! });
const { data: srs } = await admin.from("project_requests").select("id, affair_id");
const sr = (srs ?? []).find((r) => r.affair_id === OIM)!;
const path = `project-requests/${sr.id}/e2e-${FNAME}`;
const bytes = new TextEncoder().encode("PK-costing-test");

let rowId: string | null = null;
let ok = true;
const check = (label: string, cond: boolean) => {
  console.log(`${cond ? "✓" : "✗"} ${label}`);
  if (!cond) ok = false;
};

async function affairText(browser: Browser, role: string): Promise<string> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.fill('input[name="email"]', process.env[`E2E_${role.toUpperCase()}_EMAIL`] || "");
  await page.fill('input[name="password"]', process.env.E2E_PASSWORD || "");
  await Promise.all([
    page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 30000 }).catch(() => {}),
    page.click('button:has-text("Sign in")'),
  ]);
  for (let i = 0; i < 2; i++) {
    try {
      await page.goto(`${BASE}/affairs/${OIM}`, { waitUntil: "networkidle", timeout: 60000 });
      break;
    } catch {}
  }
  const text = await page.evaluate(() => (document.querySelector("main") || document.body).innerText);
  await ctx.close();
  return text.toLowerCase();
}

try {
  await admin.storage.from("documents").upload(path, bytes, { upsert: true });
  const ins = await admin
    .from("project_request_files")
    .insert({ project_request_id: sr.id, storage_path: path, file_name: FNAME, file_size: bytes.length, mime_type: "application/vnd.ms-excel", category: "costing" })
    .select("id")
    .single();
  check("insert costing OK", !ins.error);
  rowId = ins.data?.id ?? null;

  const browser = await chromium.launch();
  try {
    const ta = await affairText(browser, "admin");
    check("[admin] costing Excel visible dans Documents de l'affaire", ta.includes(FNAME.toLowerCase()));
    const ts = await affairText(browser, "sales");
    check("[sales] costing Excel INVISIBLE dans Documents de l'affaire", !ts.includes(FNAME.toLowerCase()));
  } finally {
    await browser.close();
  }
} finally {
  if (rowId) await admin.from("project_request_files").delete().eq("id", rowId);
  await admin.storage.from("documents").remove([path]).catch(() => {});
  console.log("cleanup fait");
}
console.log(ok ? "\n✅ COSTING VISIBILITY PASS" : "\n❌ COSTING VISIBILITY FAIL");
process.exit(ok ? 0 : 1);
