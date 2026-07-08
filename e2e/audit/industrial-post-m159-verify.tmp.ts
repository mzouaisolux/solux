// =====================================================================
// VERIFY POST-m159 — AUTO-GARDÉ : se skip proprement (exit 0) tant que
// 159_task_list_industrial_file.sql n'est pas dans le ledger. À relancer
// tel quel après application de la migration :
//   node --env-file=.env.local --env-file=.env.e2e --experimental-strip-types \
//     e2e/audit/industrial-post-m159-verify.tmp.ts
//
// Ce qu'il prouve en vraies sessions :
//   A. SR : le tilt est réellement PERSISTÉ (création 10° → colonne = 10),
//      puis cleanup.
//   B. Task list (TLM, sur une TL en draft — la moins risquée) :
//      éditeur LIVE (plus de hint dormant), save tilt 30° → affiché,
//      checkpoint cochable, CHANGEMENT de tilt → checkpoint RESET (le
//      scénario qui envoie un mauvais drawing à l'usine s'il régresse),
//      packaging → Customized Client → event tl.customer_branding_required
//      UNIQUE par transition + planned_action ; spare part persistée.
//   C. REVERT complet de la task list (état d'origine restauré) +
//      suppression de la planned_action créée. Les events d'audit générés
//      restent (append-only) — trace assumée, notée en sortie.
//   D. Lecture seule : si une TL under_validation avec tilt non vérifié
//      existe, la modale Release doit afficher « Checkpoint pending »
//      (gate serveur déjà couvert par tests unitaires).
// =====================================================================
import { chromium, type Page } from "playwright";
import { createClient } from "@supabase/supabase-js";

const BASE = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PASSWORD = process.env.E2E_PASSWORD!;
const AFFAIR_NAME = "E2E POST-M159 VERIFY";

let ok = true;
const check = (label: string, cond: boolean, extra = "") => {
  console.log(`${cond ? "✓" : "✗"} ${label}${extra ? ` — ${extra}` : ""}`);
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

// ---------------- GARDE m159 ----------------
{
  const { data } = await sb
    .from("schema_migrations")
    .select("filename")
    .eq("filename", "159_task_list_industrial_file.sql")
    .maybeSingle();
  if (!data) {
    console.log("⏸ m159 NOT applied — post-migration verify PENDING (rien exécuté, exit 0).");
    process.exit(0);
  }
  console.log("m159 applied — running the post-migration battery.\n");
}

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
let srAffairId: string | null = null;
let tlId: string | null = null;
let tlPre: any = null;
let plannedActionCleanup: { affair_id: string; title: string } | null = null;
try {
  // ================= A. SR — tilt PERSISTÉ =================
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await login(page, process.env.E2E_SALES_EMAIL!);
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
    await page.click('button:has-text("Next →")');
    await page.waitForTimeout(300);
    await page.click('button:has-text("Next →")');
    await page.waitForTimeout(300);
    await page.locator('select[aria-label="Solar panel tilt angle"]').selectOption("10");
    await page.click('button:has-text("Next →")');
    await page.waitForTimeout(400);
    await Promise.all([
      page
        .waitForURL((u) => /\/projects\/[0-9a-f-]{36}/.test(u.pathname), { timeout: 30000 })
        .catch(() => {}),
      page.click('button:has-text("Create service request")'),
    ]);
    srId = page.url().match(/\/projects\/([0-9a-f-]{36})/)?.[1] ?? null;
    check("A. SR créée", !!srId);
    if (srId) {
      const { data: row } = await sb
        .from("project_requests")
        .select("solar_panel_tilt_angle, affair_id")
        .eq("id", srId)
        .maybeSingle();
      srAffairId = (row as any)?.affair_id ?? null;
      check(
        "A. tilt PERSISTÉ en DB (colonne = 10)",
        Number((row as any)?.solar_panel_tilt_angle) === 10,
        `got ${(row as any)?.solar_panel_tilt_angle}`
      );
      check(
        "A. fiche SR affiche « Panel tilt angle 10° »",
        await page.locator("text=10°").first().isVisible()
      );
    }
    await ctx.close();
  }

  // ================= B. Task list DRAFT — éditeur live =================
  const { data: tls } = await sb
    .from("production_task_lists")
    .select("id, number, status, affair_id, solar_panel_tilt_angle, pole_drawing_tilt_verified, pole_drawing_tilt_verified_by, pole_drawing_tilt_verified_at, industrial_spec")
    .eq("status", "draft")
    .order("date", { ascending: false })
    .limit(1);
  const tl = (tls ?? [])[0] as any;
  if (!tl) {
    skip("B. aucune task list en draft — éditeur live non testé (créer un draft puis relancer)");
  } else {
    tlId = tl.id;
    tlPre = tl; // état d'origine pour le REVERT
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await login(page, process.env.E2E_TLM_EMAIL!);
    const goto = () =>
      page.goto(`${BASE}/task-lists/${tl.id}`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await goto();

    check(
      `B. ${tl.number}: éditeur LIVE (plus de hint dormant)`,
      (await page.locator("text=migration m159").count()) === 0 &&
        (await page.locator('[data-testid="save-industrial-file"]').count()) === 1
    );

    // Save tilt 30° + packaging custom + spare part, en un seul Save.
    await page.locator('button:has-text("30°")').first().click();
    await page.locator('label:has-text("Customized Client version")').click();
    await page.locator('[data-testid="add-spare-part"]').click();
    await page.locator('input[placeholder="e.g. Battery"]').fill("Battery");
    await page.locator('input[placeholder="Model / reference"]').fill("LFP-60-BENCH");
    await page.locator('[data-testid="save-industrial-file"]').click();
    await page.waitForTimeout(2500);
    await goto();
    check(
      "B. tilt 30° persisté et affiché",
      await page.locator('[data-testid="tilt-angle-value"]:has-text("30°")').isVisible()
    );
    check(
      "B. spare part persistée après reload",
      await page.locator('input[value="LFP-60-BENCH"]').count() > 0 ||
        (await page.locator('input[placeholder="Model / reference"]').first().inputValue()) ===
          "LFP-60-BENCH"
    );

    // Event branding UNIQUE par transition + planned_action.
    const countBranding = async () => {
      const { data } = await sb
        .from("events")
        .select("id")
        .eq("entity_type", "task_list")
        .eq("entity_id", tl.id)
        .eq("event_type", "tl.customer_branding_required");
      return (data ?? []).length;
    };
    const n1 = await countBranding();
    check("B. event tl.customer_branding_required émis", n1 >= 1, `count=${n1}`);
    if (tl.affair_id) {
      const { data: pa } = await sb
        .from("planned_actions")
        .select("id, title")
        .eq("affair_id", tl.affair_id)
        .eq("title", "Collect customer branding for packaging");
      check("B. planned_action Sales créée sur l'affaire", (pa ?? []).length >= 1);
      plannedActionCleanup = { affair_id: tl.affair_id, title: "Collect customer branding for packaging" };
    }
    // Re-save SANS changer le packaging → pas de doublon d'event.
    await page.locator('[data-testid="save-industrial-file"]').click();
    await page.waitForTimeout(2000);
    const n2 = await countBranding();
    check("B. re-save = PAS de doublon d'event (transition-only)", n2 === n1, `avant=${n1} après=${n2}`);

    // Checkpoint : cocher, puis CHANGER le tilt → doit se RESET.
    const checkpoint = page.locator('[data-testid="tilt-checkpoint"]');
    await goto();
    if (await checkpoint.isEnabled()) {
      await checkpoint.check();
      await page.waitForTimeout(2000);
      await goto();
      check("B. checkpoint cochable et persisté", await checkpoint.isChecked());
      await page.locator('button:has-text("45°")').first().click();
      await page.locator('[data-testid="save-industrial-file"]').click();
      await page.waitForTimeout(2500);
      await goto();
      check(
        "B. ⚠ CHANGEMENT de tilt (30→45) → checkpoint RESET",
        !(await checkpoint.isChecked())
      );
    } else {
      skip("B. checkpoint non activable (capability TLM ?) — vérifier task_list.validate");
    }
    await ctx.close();
  }

  // ================= D. Lecture seule — modale Release =================
  const { data: uvs } = await sb
    .from("production_task_lists")
    .select("id, number, solar_panel_tilt_angle, pole_drawing_tilt_verified")
    .eq("status", "under_validation")
    .not("solar_panel_tilt_angle", "is", null)
    .eq("pole_drawing_tilt_verified", false)
    .limit(1);
  const uv = (uvs ?? [])[0] as any;
  if (!uv) {
    skip("D. aucune TL under_validation avec checkpoint pending — modale Release non observée (gate couvert par tests unitaires)");
  } else {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await login(page, process.env.E2E_TLM_EMAIL!);
    await page.goto(`${BASE}/task-lists/${uv.id}`, { waitUntil: "domcontentloaded", timeout: 45000 });
    const releaseBtn = page.locator('button:has-text("Validate")').first();
    if ((await releaseBtn.count()) > 0) {
      await releaseBtn.click();
      await page.waitForTimeout(800);
      check(
        `D. ${uv.number}: modale Release affiche « Checkpoint pending »`,
        await page.locator("text=Checkpoint pending").isVisible()
      );
    } else {
      skip("D. bouton Validate introuvable sur cette TL");
    }
    await ctx.close();
  }
} finally {
  await browser.close();
  // ================= C. REVERT =================
  if (tlId && tlPre) {
    const { error } = await sb
      .from("production_task_lists")
      .update({
        solar_panel_tilt_angle: tlPre.solar_panel_tilt_angle ?? null,
        pole_drawing_tilt_verified: tlPre.pole_drawing_tilt_verified ?? false,
        pole_drawing_tilt_verified_by: tlPre.pole_drawing_tilt_verified_by ?? null,
        pole_drawing_tilt_verified_at: tlPre.pole_drawing_tilt_verified_at ?? null,
        industrial_spec: tlPre.industrial_spec ?? {},
      })
      .eq("id", tlId);
    console.log(error ? `⚠ revert TL failed: ${error.message}` : "🧹 task list revertée à l'état d'origine");
  }
  if (plannedActionCleanup) {
    const { error } = await sb
      .from("planned_actions")
      .delete()
      .eq("affair_id", plannedActionCleanup.affair_id)
      .eq("title", plannedActionCleanup.title);
    console.log(error ? `⚠ cleanup planned_action failed: ${error.message}` : "🧹 planned_action supprimée");
  }
  if (srId) {
    const { error } = await sb.from("project_requests").delete().eq("id", srId);
    console.log(error ? `⚠ cleanup SR failed: ${error.message}` : "🧹 SR supprimée");
  }
  if (srAffairId) {
    const { error } = await sb.from("affairs").delete().eq("id", srAffairId).eq("name", AFFAIR_NAME);
    console.log(error ? `⚠ cleanup affaire failed: ${error.message}` : "🧹 affaire supprimée");
  }
  console.log("ℹ les events d'audit générés (header_changed / branding) restent — append-only, trace assumée.");
}

console.log(ok ? "\n✅ POST-m159 VERIFY — PASS" : "\n❌ POST-m159 VERIFY — FAIL");
process.exit(ok ? 0 : 1);
