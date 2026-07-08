// =====================================================================
// VERIFY — collector SSoT : un fichier uploadé sur la SR remonte dans
// l'onglet Documents de l'affaire (folder Technical). Round-trip complet :
// upload Storage réel + row project_request_files ('drawing', pré-m157 OK)
// → page /affairs/<OIM> → cleanup.
// =====================================================================
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const BASE = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const OIM = "65755e17-6a3e-4bab-b658-e52c20f7e70b";
const SR_PREFIX = "43c0b1b4";
const FNAME = "collector-verify-pole-drawing.pdf";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
await sb.auth.signInWithPassword({ email: process.env.E2E_ADMIN_EMAIL!, password: process.env.E2E_PASSWORD! });
const { data: srs } = await sb.from("project_requests").select("id, affair_id");
const sr = (srs ?? []).find((r) => r.id.startsWith(SR_PREFIX))!;
if (sr.affair_id !== OIM) console.log(`⚠ SR affair=${sr.affair_id}`);

const path = `project-requests/${sr.id}/e2e-${FNAME}`;
const pdfBytes = new TextEncoder().encode("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
let rowId: string | null = null;
let ok = true;
const check = (label: string, cond: boolean) => {
  console.log(`${cond ? "✓" : "✗"} ${label}`);
  if (!cond) ok = false;
};
try {
  const up = await sb.storage.from("documents").upload(path, pdfBytes, { contentType: "application/pdf", upsert: true });
  check("upload storage", !up.error);
  const ins = await sb
    .from("project_request_files")
    .insert({ project_request_id: sr.id, storage_path: path, file_name: FNAME, file_size: pdfBytes.length, mime_type: "application/pdf", category: "drawing" })
    .select("id")
    .single();
  check("insert row", !ins.error);
  rowId = ins.data?.id ?? null;

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.fill('input[name="email"]', process.env.E2E_ADMIN_EMAIL || "");
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
    const text = (await page.evaluate(() => (document.querySelector("main") || document.body).innerText)).toLowerCase();
    check("fichier SR visible dans l'onglet Documents de l'affaire", text.includes(FNAME.toLowerCase()));
  } finally {
    await browser.close();
  }
} finally {
  if (rowId) await sb.from("project_request_files").delete().eq("id", rowId);
  await sb.storage.from("documents").remove([path]).catch(() => {});
  console.log("cleanup fait (row + storage)");
}
console.log(ok ? "\n✅ COLLECTOR PASS" : "\n❌ COLLECTOR FAIL");
process.exit(ok ? 0 : 1);
