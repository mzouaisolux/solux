// =====================================================================
// VERIFY — Task List industrial round (owner spec 2026-07-08), état
// PRÉ-m159 (dormant) :
//   1. /projects/new (Sales réel) : champ « Solar panel tilt angle »
//      présent (presets 0/10/15/20/30/45 + Custom), wizard BLOQUÉ sur
//      Configuration sans tilt, débloqué avec 15°, summary l'affiche.
//   2. Création RÉELLE d'une SR avec tilt → détail atteint (écriture
//      défensive pré-m159 : la création n'échoue pas malgré la colonne
//      absente).
//   3. Task list (TLM réel) : section « Industrial production file »
//      présente avec le hint dormant m159 + chip nav « Industrial file »
//      + modale Release inchangée (checkpoint non bloquant pré-m159).
//   4. Freight validity : pills 7/15/30 jours, plus AUCUN « 60 days »
//      (SR existante avec freight, rôle operations) — skip si aucune.
//   5. Cleanup : suppression de la SR + affaire créées (best effort).
// Jamais de signOut() (révoquerait les storageState — mémoire E2E).
// =====================================================================
import { chromium, type Page } from "playwright";
import { createClient } from "@supabase/supabase-js";

const BASE = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PASSWORD = process.env.E2E_PASSWORD!;
const AFFAIR_NAME = "E2E TILT VERIFY 2026-07-08";

let ok = true;
const check = (label: string, cond: boolean) => {
  console.log(`${cond ? "✓" : "✗"} ${label}`);
  if (!cond) ok = false;
};
const skip = (label: string) => console.log(`• ${label} (skipped)`);

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
);
await sb.auth.signInWithPassword({
  email: process.env.E2E_ADMIN_EMAIL!,
  password: PASSWORD,
});

async function login(page: Page, email: string) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 30000 }).catch(() => {}),
    page.click('button:has-text("Sign in")'),
  ]);
}

const browser = await chromium.launch();
let createdSrId: string | null = null;
let createdAffairId: string | null = null;
try {
  // ------------------------------------------------ 1+2 : SALES — SR form
  const salesCtx = await browser.newContext();
  const sales = await salesCtx.newPage();
  await login(sales, process.env.E2E_SALES_EMAIL!);

  await sales.goto(`${BASE}/projects/new`, { waitUntil: "domcontentloaded", timeout: 30000 });
  const tiltSelect = sales.locator('select[aria-label="Solar panel tilt angle"]');
  check("SR form: tilt select present", (await tiltSelect.count()) === 1);
  const optionTexts = await tiltSelect.locator("option").allTextContents();
  check(
    "SR form: presets 0/10/15/20/30/45° + Custom",
    ["0°", "10°", "15°", "20°", "30°", "45°"].every((t) => optionTexts.includes(t)) &&
      optionTexts.some((t) => /custom/i.test(t))
  );

  // Pick a real client, name a NEW affair (mandatory), advance the wizard.
  const clientSel = sales.locator('select[name="client_id"]');
  const firstClient = await clientSel.locator("option").nth(1).getAttribute("value");
  check("SR form: a client is selectable", !!firstClient);
  // Wait for React hydration: retry the select until the dependent affair
  // fields unlock (their disabled state is driven by the clientId state).
  const affairInput = sales.locator('input[name="new_affair_name"]');
  for (let i = 0; i < 10; i++) {
    await clientSel.selectOption(firstClient!);
    await sales.waitForTimeout(500);
    if (await affairInput.isEnabled()) break;
  }
  await sales.fill('input[name="new_affair_name"]', AFFAIR_NAME);
  await sales.click('button:has-text("Next →")'); // → Services
  await sales.waitForTimeout(300);
  await sales.click('button:has-text("Next →")'); // → Configuration
  await sales.waitForTimeout(300);
  check(
    "wizard on Configuration (step 3 of 4)",
    await sales.locator("text=Step 3 of 4").isVisible()
  );
  // WITHOUT tilt: Next must be refused (stay on step 3).
  await sales.click('button:has-text("Next →")');
  await sales.waitForTimeout(400);
  check(
    "MANDATORY: Next blocked without tilt angle",
    await sales.locator("text=Step 3 of 4").isVisible()
  );
  // Choose 15° → Review reachable, summary shows the angle.
  await tiltSelect.selectOption("15");
  await sales.click('button:has-text("Next →")');
  await sales.waitForTimeout(400);
  // On Review (last step) the wizard note switches to the draft hint and the
  // Create button appears — that's the reliable "Review reached" signal.
  const onReview = await sales
    .locator('button:has-text("Create service request")')
    .isVisible();
  check("with 15°: Review step reachable", onReview);
  check(
    "summary shows Panel tilt angle 15°",
    await sales.locator(".form-summary").getByText("15°", { exact: true }).isVisible()
  );
  // REAL creation (server action; defensive write pre-m159 must not fail).
  await Promise.all([
    sales
      .waitForURL((u) => /\/projects\/[0-9a-f-]{36}/.test(u.pathname), { timeout: 30000 })
      .catch(() => {}),
    sales.click('button:has-text("Create service request")'),
  ]);
  const detailUrl = sales.url();
  const m = detailUrl.match(/\/projects\/([0-9a-f-]{36})/);
  createdSrId = m?.[1] ?? null;
  check("SR created with tilt (defensive write pre-m159)", !!createdSrId);
  if (createdSrId) {
    const { data: srRow } = await sb
      .from("project_requests")
      .select("id, affair_id, name")
      .eq("id", createdSrId)
      .maybeSingle();
    createdAffairId = (srRow as any)?.affair_id ?? null;
    check("SR row exists in DB", !!srRow);
  }
  await salesCtx.close();

  // ------------------------------------------------ 3 : TLM — task list
  const { data: tls } = await sb
    .from("production_task_lists")
    .select("id, number, status")
    .neq("status", "cancelled")
    .order("date", { ascending: false })
    .limit(1);
  const tl = (tls ?? [])[0] as any;
  if (!tl) {
    skip("no task list found for the Industrial file check");
  } else {
    const tlmCtx = await browser.newContext();
    const tlm = await tlmCtx.newPage();
    await login(tlm, process.env.E2E_TLM_EMAIL!);
    await tlm.goto(`${BASE}/task-lists/${tl.id}`, { waitUntil: "domcontentloaded", timeout: 45000 });
    check(
      `task list ${tl.number}: section "Industrial production file" present`,
      await tlm.locator('h2#tl-industrial:has-text("Industrial production file")').isVisible()
    );
    check(
      'nav chip "Industrial file" present',
      await tlm.locator('a[href="#tl-industrial"]').isVisible()
    );
    check(
      "dormant hint m159 shown (pre-migration)",
      await tlm.locator("text=migration m159").first().isVisible()
    );
    await tlmCtx.close();
  }

  // ------------------------------------------------ 4 : freight pills 7/15/30
  const { data: fr } = await sb
    .from("freight_cost_requests")
    .select("project_request_id")
    .limit(1);
  const frRow = (fr ?? [])[0] as any;
  if (!frRow) {
    skip("no freight request found for the validity-pills check");
  } else {
    const opCtx = await browser.newContext();
    const op = await opCtx.newPage();
    await login(op, process.env.E2E_OPERATION_EMAIL!);
    await op.goto(`${BASE}/projects/${frRow.project_request_id}`, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    const hasValidityBlock = await op.locator("text=Freight valid until").count();
    if (hasValidityBlock === 0) {
      skip("freight entry form not visible on this SR (status/role) — pills untestable here");
    } else {
      check('freight pills: "7 days" present', (await op.locator('button:has-text("7 days")').count()) > 0);
      check('freight pills: "15 days" present', (await op.locator('button:has-text("15 days")').count()) > 0);
      check('freight pills: "30 days" present', (await op.locator('button:has-text("30 days")').count()) > 0);
      check('freight pills: NO "60 days"', (await op.locator('button:has-text("60 days")').count()) === 0);
      check('freight pills: NO "90 days"', (await op.locator('button:has-text("90 days")').count()) === 0);
    }
    await opCtx.close();
  }
} finally {
  await browser.close();
  // ------------------------------------------------ 5 : cleanup (best effort)
  if (createdSrId) {
    const { error } = await sb.from("project_requests").delete().eq("id", createdSrId);
    console.log(error ? `⚠ cleanup SR failed: ${error.message}` : "🧹 SR deleted");
  }
  if (createdAffairId) {
    const { error } = await sb
      .from("affairs")
      .delete()
      .eq("id", createdAffairId)
      .eq("name", AFFAIR_NAME);
    console.log(error ? `⚠ cleanup affair failed: ${error.message}` : "🧹 affair deleted");
  }
}

console.log(ok ? "\n✅ INDUSTRIAL FILE VERIFY — PASS" : "\n❌ INDUSTRIAL FILE VERIFY — FAIL");
process.exit(ok ? 0 : 1);
