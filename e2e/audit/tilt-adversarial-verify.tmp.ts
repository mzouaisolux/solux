// =====================================================================
// ADVERSARIAL PRÉ-m159 — les pièges du tilt angle en vraies sessions :
//   1. TILT 0° (le piège falsy JS) : 0 est un angle VALIDE — le wizard
//      doit laisser passer, le summary doit afficher « 0° », la création
//      doit réussir.
//   2. ÉDITION d'un draft : le tilt reste OBLIGATOIRE en mode edit, et
//      updateProjectRequest passe par l'écriture DÉFENSIVE pré-m159
//      (colonne absente → retry sans) — chemin jamais prouvé E2E.
//   3. Cleanup complet (SR + affaire).
// Jamais de signOut() (révoquerait les storageState).
// =====================================================================
import { chromium, type Page } from "playwright";
import { createClient } from "@supabase/supabase-js";

const BASE = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PASSWORD = process.env.E2E_PASSWORD!;
const AFFAIR_NAME = "E2E TILT ZERO 2026-07-08";

let ok = true;
const check = (label: string, cond: boolean, extra = "") => {
  console.log(`${cond ? "✓" : "✗"} ${label}${extra ? ` — ${extra}` : ""}`);
  if (!cond) ok = false;
};

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
let srId: string | null = null;
let affairId: string | null = null;
try {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, process.env.E2E_SALES_EMAIL!);

  // ---------- 1. Création avec TILT = 0° (falsy) ----------
  await page.goto(`${BASE}/projects/new`, { waitUntil: "domcontentloaded", timeout: 30000 });
  const clientSel = page.locator('select[name="client_id"]');
  const firstClient = await clientSel.locator("option").nth(1).getAttribute("value");
  const affairInput = page.locator('input[name="new_affair_name"]');
  for (let i = 0; i < 10; i++) {
    await clientSel.selectOption(firstClient!);
    await page.waitForTimeout(500);
    if (await affairInput.isEnabled()) break;
  }
  await page.fill('input[name="new_affair_name"]', AFFAIR_NAME);
  await page.click('button:has-text("Next →")'); // Services
  await page.waitForTimeout(300);
  await page.click('button:has-text("Next →")'); // Configuration
  await page.waitForTimeout(300);
  const tiltSelect = page.locator('select[aria-label="Solar panel tilt angle"]');
  await tiltSelect.selectOption("0");
  await page.click('button:has-text("Next →")'); // Review
  await page.waitForTimeout(400);
  check(
    "TILT 0°: Review atteignable (0 n'est pas traité comme vide)",
    await page.locator('button:has-text("Create service request")').isVisible()
  );
  check(
    "TILT 0°: summary affiche « 0° »",
    await page.locator(".form-summary").getByText("0°", { exact: true }).isVisible()
  );
  await Promise.all([
    page
      .waitForURL((u) => /\/projects\/[0-9a-f-]{36}/.test(u.pathname), { timeout: 30000 })
      .catch(() => {}),
    page.click('button:has-text("Create service request")'),
  ]);
  const m = page.url().match(/\/projects\/([0-9a-f-]{36})/);
  srId = m?.[1] ?? null;
  check("TILT 0°: création réelle réussie", !!srId);
  if (srId) {
    const { data: row } = await sb
      .from("project_requests")
      .select("id, affair_id, status")
      .eq("id", srId)
      .maybeSingle();
    affairId = (row as any)?.affair_id ?? null;
    check("SR en DB, statut draft", (row as any)?.status === "draft");
  }

  // ---------- 2. Édition du draft : tilt obligatoire + update défensif ----------
  if (srId) {
    await page.goto(`${BASE}/projects/new?edit=${srId}`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    // Pré-m159 le tilt n'a pas été stocké → prefill VIDE attendu.
    await page.waitForTimeout(800);
    const val = await tiltSelect.inputValue().catch(() => "n/a");
    check("EDIT: prefill tilt vide (colonne absente pré-m159)", val === "");
    // Edit mode: General/Services sautables ; le tilt reste OBLIGATOIRE.
    await page.click('button:has-text("Next →")'); // Services
    await page.waitForTimeout(300);
    await page.click('button:has-text("Next →")'); // Configuration
    await page.waitForTimeout(300);
    await page.click('button:has-text("Next →")'); // sans tilt → bloqué
    await page.waitForTimeout(400);
    check(
      "EDIT: Next bloqué sans tilt (règle tenue aussi en édition)",
      await page.locator("text=Step 3 of 4").isVisible()
    );
    await tiltSelect.selectOption("45");
    await page.click('button:has-text("Next →")');
    await page.waitForTimeout(400);
    const canSave = await page.locator('button:has-text("Save changes")').isVisible();
    check("EDIT: Review atteignable avec 45°", canSave);
    if (canSave) {
      await Promise.all([
        page
          .waitForURL((u) => new RegExp(`/projects/${srId}`).test(u.pathname + u.search), {
            timeout: 30000,
          })
          .catch(() => {}),
        page.click('button:has-text("Save changes")'),
      ]);
      check(
        "EDIT: updateProjectRequest réussi (écriture défensive pré-m159)",
        new RegExp(`/projects/${srId}`).test(page.url())
      );
    }
  }
  await ctx.close();
} finally {
  await browser.close();
  if (srId) {
    const { error } = await sb.from("project_requests").delete().eq("id", srId);
    console.log(error ? `⚠ cleanup SR failed: ${error.message}` : "🧹 SR deleted");
  }
  if (affairId) {
    const { error } = await sb.from("affairs").delete().eq("id", affairId).eq("name", AFFAIR_NAME);
    console.log(error ? `⚠ cleanup affair failed: ${error.message}` : "🧹 affair deleted");
  }
}

console.log(ok ? "\n✅ TILT ADVERSARIAL — PASS" : "\n❌ TILT ADVERSARIAL — FAIL");
process.exit(ok ? 0 : 1);
