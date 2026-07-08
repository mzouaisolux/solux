// =====================================================================
// VERIFY — SR dossier technique (m157 dormant) + visibilité par rôle.
//   ops  : section Factory cost affiche les blocs Costing Excel + Pole
//          drawing (hints « activates once m157 applied » avant migration,
//          uploaders après) ; note « Strongly recommended » visible.
//   sales: jamais de bloc costing (section coût entière masquée).
// =====================================================================
import { chromium, type Browser, type Page } from "playwright";
import { createClient } from "@supabase/supabase-js";

const BASE = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/$/, "");

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
await sb.auth.signInWithPassword({ email: process.env.E2E_ADMIN_EMAIL!, password: process.env.E2E_PASSWORD! });
// une SR avec pricing demandé + cost row existante
const { data: srs } = await sb
  .from("project_requests")
  .select("id, name, status, req_product_pricing, pole_required")
  .eq("req_product_pricing", true)
  .order("created_at", { ascending: false });
const { data: fcrs } = await sb.from("factory_cost_requests").select("project_request_id");
const withCost = new Set((fcrs ?? []).map((r) => r.project_request_id));
const sr = (srs ?? []).find((r) => withCost.has(r.id)) ?? (srs ?? [])[0];
if (!sr) { console.log("aucune SR de test"); process.exit(1); }
console.log(`SR test: ${sr.name} (${sr.id.slice(0, 8)}) status=${sr.status} pole_required=${sr.pole_required} costRow=${withCost.has(sr.id)}`);
const { data: mig } = await sb.from("schema_migrations").select("filename").eq("filename", "157_sr_technical_dossier.sql").maybeSingle();
const m157 = Boolean(mig);
console.log(`m157 appliquée: ${m157}\n`);

async function login(browser: Browser, role: string): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.fill('input[name="email"]', process.env[`E2E_${role.toUpperCase()}_EMAIL`] || "");
  await page.fill('input[name="password"]', process.env.E2E_PASSWORD || "");
  await Promise.all([
    page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 30000 }).catch(() => {}),
    page.click('button:has-text("Sign in")'),
  ]);
  return page;
}
const mainText = async (p: Page) => {
  for (let i = 0; i < 2; i++) {
    try {
      await p.goto(`${BASE}/projects/${sr.id}`, { waitUntil: "networkidle", timeout: 60000 });
      break;
    } catch {}
  }
  return p.evaluate(() => (document.querySelector("main") || document.body).innerText);
};

const browser = await chromium.launch();
let ok = true;
const check = (label: string, cond: boolean) => {
  console.log(`${cond ? "✓" : "✗"} ${label}`);
  if (!cond) ok = false;
};
try {
  // innerText reflects CSS text-transform (section headers are uppercased) —
  // compare case-insensitively.
  const ops = await login(browser, "operation");
  const to = (await mainText(ops)).toLowerCase();
  check("[ops] section Factory cost visible", to.includes("factory cost"));
  check("[ops] bloc Costing Excel visible", to.includes("costing excel"));
  if (sr.pole_required !== false) {
    check("[ops] note Strongly recommended (pole drawing)", to.includes("strongly recommended"));
    check("[ops] bloc Pole drawing visible", to.includes("pole drawing"));
  }
  if (!m157) {
    check("[ops] hint dormant m157 affiché", to.includes("migration m157 is applied"));
  } else {
    check("[ops] uploaders actifs (pas de hint m157)", !to.includes("migration m157 is applied"));
    check("[ops] champs panneau réel visibles", to.includes("actual solar panel used"));
  }
  await ops.context().close();

  const sales = await login(browser, "sales");
  const ts = (await mainText(sales)).toLowerCase();
  check("[sales] AUCUN bloc costing visible", !ts.includes("costing excel"));
  check("[sales] coûts RMB masqués", !ts.includes("factory cost"));
  await sales.context().close();
} finally {
  await browser.close();
}
console.log(ok ? "\n✅ SR DOSSIER PASS" : "\n❌ SR DOSSIER FAIL");
process.exit(ok ? 0 : 1);
