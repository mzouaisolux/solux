// =====================================================================
// GATE LIVE VERIFY (post-m159) — les 2 preuves restantes, assertions DB
// (insensibles aux flakes UI/hydration/dev-server lent) :
//   1. checkpoint coché (DB=true) puis CHANGEMENT de tilt → DB repasse à
//      false (RESET — le scénario mauvais-drawing-usine).
//   2. GATE SERVEUR non-trivial : « Mark production ready » avec
//      checkpoint pending → statut DB INCHANGÉ **et** le message d'erreur
//      du gate apparaît côté UI (preuve que le clic a bien atteint le
//      serveur et a été REFUSÉ, pas un no-op d'hydration).
// Cible : la TL de test QKP (validated). REVERT complet à la fin.
// =====================================================================
import { chromium, type Page } from "playwright";
import { createClient } from "@supabase/supabase-js";

const BASE = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PASSWORD = process.env.E2E_PASSWORD!;

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

// Cible : TL de test (QKP/QCK/QOC), pré-terminale.
const { data: tls } = await sb
  .from("production_task_lists")
  .select("id, number, status, solar_panel_tilt_angle, pole_drawing_tilt_verified, pole_drawing_tilt_verified_by, pole_drawing_tilt_verified_at, industrial_spec")
  .in("status", ["validated", "under_validation"])
  .order("date", { ascending: false })
  .limit(10);
const tl = ((tls ?? []) as any[]).find((t) => /-(QKP|QCK|QOC)-/.test(t.number ?? ""));
if (!tl) {
  console.log("⏸ aucune TL de test validated/under_validation — rien exécuté.");
  process.exit(0);
}
console.log(`Cible : ${tl.number} (${tl.status})\n`);

const dbState = async () => {
  const { data } = await sb
    .from("production_task_lists")
    .select("status, solar_panel_tilt_angle, pole_drawing_tilt_verified")
    .eq("id", tl.id)
    .maybeSingle();
  return data as any;
};

async function login(page: Page, email: string) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 60000 }).catch(() => {}),
    page.click('button:has-text("Sign in")'),
  ]);
}

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, process.env.E2E_TLM_EMAIL!);
  const goto = async () => {
    for (let i = 0; i < 3; i++) {
      try {
        await page.goto(`${BASE}/task-lists/${tl.id}`, {
          waitUntil: "domcontentloaded",
          timeout: 90000,
        });
        await page.waitForTimeout(2500); // settle hydration
        return;
      } catch {
        /* dev server slow — retry */
      }
    }
    throw new Error("task list page unreachable");
  };

  // ---- 1a. Poser tilt 30° (retry jusqu'à DB=30) ----
  await goto();
  for (let i = 0; i < 4; i++) {
    await page.locator('button:has-text("30°")').first().click().catch(() => {});
    await page.locator('[data-testid="save-industrial-file"]').click().catch(() => {});
    await page.waitForTimeout(3000);
    if (Number((await dbState())?.solar_panel_tilt_angle) === 30) break;
    await goto();
  }
  check("tilt 30° posé (DB)", Number((await dbState())?.solar_panel_tilt_angle) === 30);

  // ---- 1b. Cocher le checkpoint (retry jusqu'à DB=true) ----
  await goto();
  for (let i = 0; i < 4; i++) {
    await page.locator('[data-testid="tilt-checkpoint"]').click({ force: true }).catch(() => {});
    await page.waitForTimeout(3000);
    if ((await dbState())?.pole_drawing_tilt_verified === true) break;
    await goto();
  }
  check("checkpoint coché (DB=true)", (await dbState())?.pole_drawing_tilt_verified === true);

  // ---- 1c. CHANGER le tilt 30→45 → RESET du checkpoint (DB=false) ----
  await goto();
  for (let i = 0; i < 4; i++) {
    await page.locator('button:has-text("45°")').first().click().catch(() => {});
    await page.locator('[data-testid="save-industrial-file"]').click().catch(() => {});
    await page.waitForTimeout(3000);
    if (Number((await dbState())?.solar_panel_tilt_angle) === 45) break;
    await goto();
  }
  const afterChange = await dbState();
  check("tilt changé 30→45 (DB)", Number(afterChange?.solar_panel_tilt_angle) === 45);
  check(
    "⚠ RESET : checkpoint repassé à false après changement de tilt",
    afterChange?.pole_drawing_tilt_verified === false
  );

  // ---- 2. GATE SERVEUR : release refusée, non-trivialement ----
  // État : tilt 45, checkpoint pending. Clic « Mark production ready » →
  // le serveur doit REFUSER : statut inchangé + message du gate visible.
  await goto();
  const readyBtn = page.locator('button:has-text("Mark production ready")').first();
  if ((await readyBtn.count()) === 0) {
    check("bouton Mark production ready présent", false);
  } else {
    let sawGateMessage = false;
    for (let i = 0; i < 3 && !sawGateMessage; i++) {
      await readyBtn.click().catch(() => {});
      await page.waitForTimeout(4000);
      const body = (await page.textContent("body").catch(() => "")) ?? "";
      sawGateMessage = /checkpoint pending|pole drawing.*(hasn't|not) been verified|Industrial production file section before releasing/i.test(
        body
      );
      if (!sawGateMessage) await goto();
    }
    const afterAttack = await dbState();
    check(
      "🔒 GATE : statut DB inchangé après tentative de release",
      afterAttack?.status === tl.status,
      `statut ${String(afterAttack?.status)}`
    );
    check(
      "🔒 GATE : message de refus du checkpoint affiché (clic bien parvenu au serveur)",
      sawGateMessage
    );
  }
  await ctx.close();
} finally {
  await browser.close();
  const { error } = await sb
    .from("production_task_lists")
    .update({
      solar_panel_tilt_angle: tl.solar_panel_tilt_angle ?? null,
      pole_drawing_tilt_verified: tl.pole_drawing_tilt_verified ?? false,
      pole_drawing_tilt_verified_by: tl.pole_drawing_tilt_verified_by ?? null,
      pole_drawing_tilt_verified_at: tl.pole_drawing_tilt_verified_at ?? null,
      industrial_spec: tl.industrial_spec ?? {},
    })
    .eq("id", tl.id);
  console.log(error ? `⚠ revert failed: ${error.message}` : "🧹 TL revertée à l'état d'origine");
}

console.log(ok ? "\n✅ GATE LIVE VERIFY — PASS" : "\n❌ GATE LIVE VERIFY — FAIL");
process.exit(ok ? 0 : 1);
