// =====================================================================
// VERIFY — round « Product Dictionary + AI Find » (pré-m160 dormant) :
//   A. AI FIND réel : sur la TL liée au VRAI Energy Study client
//      (Simulation énergétique SSLXPRO 80 — Malanville), clic sur
//      « AI Find from Energy Study » → bannière found/empty (jamais le
//      chemin erreur) ; si found → tilt écrit en DB. Sinon (aucune TL
//      avec étude) : chemin d'erreur « No Energy Study uploaded » sur QKP
//      + extraction directe du VRAI PDF via la lib (preuve extracteur).
//   B. SPARE PARTS PRODUCT-AWARE : 2 items de test insérés au
//      dictionnaire (colonnes base — m160 pas appliquée → génériques),
//      la carte spare-part les propose groupés par type, le pick
//      auto-remplit modèle + factory name, Save → snapshot persisté en DB
//      (dictionary_item_id + factory_name).
//   C. ADMIN : /admin/components = « Industrial dictionary » + hint m160.
//   D. REVERT complet (TL + dictionnaire de test).
// Patterns anti-hydration : settle + retry-jusqu'à-persistance-DB.
// =====================================================================
import { chromium, type Page } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { extractLightingFromEnergyStudy } from "../../lib/lighting/extract-energy-study.ts";

const BASE = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PASSWORD = process.env.E2E_PASSWORD!;

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

async function login(page: Page, email: string) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 60000 }).catch(() => {}),
    page.click('button:has-text("Sign in")'),
  ]);
}

// ---- Cible : TL liée à un lighting setup AVEC energy study, sinon QKP ----
const { data: setups } = await sb
  .from("product_lighting_setups")
  .select("document_id, energy_study_path, energy_study_name")
  .not("energy_study_path", "is", null);
let tl: any = null;
let hasStudy = false;
for (const s of (setups ?? []) as any[]) {
  const { data: t } = await sb
    .from("production_task_lists")
    .select("id, number, status, solar_panel_tilt_angle, pole_drawing_tilt_verified, pole_drawing_tilt_verified_by, pole_drawing_tilt_verified_at, industrial_spec")
    .eq("quotation_id", s.document_id)
    .maybeSingle();
  if (t) {
    tl = t;
    hasStudy = true;
    console.log(`Cible AI Find : ${t.number} (étude: ${s.energy_study_name})\n`);
    break;
  }
}
if (!tl) {
  const { data: tls } = await sb
    .from("production_task_lists")
    .select("id, number, status, solar_panel_tilt_angle, pole_drawing_tilt_verified, pole_drawing_tilt_verified_by, pole_drawing_tilt_verified_at, industrial_spec")
    .in("status", ["draft", "needs_revision", "under_validation", "validated"])
    .order("date", { ascending: false })
    .limit(10);
  tl = ((tls ?? []) as any[]).find((t) => /-(QKP|QCK|QOC)-/.test(t.number ?? "")) ?? (tls ?? [])[0];
  if (tl) console.log(`Cible (sans étude) : ${tl.number}\n`);
}
if (!tl) {
  console.log("⏸ aucune task list disponible — rien exécuté.");
  process.exit(0);
}

// ---- Items de dictionnaire de test (colonnes base, pré-m160) ----
const DICT = [
  { commercial_name: "E2E Battery 25.6V 65Ah", internal_reference: "LFP25-65AH-V6", category: "battery" },
  { commercial_name: "E2E MPPT Controller V6", internal_reference: "CTRL-MPPT-V6", category: "controller" },
];
const dictIds: string[] = [];

const browser = await chromium.launch();
try {
  for (const d of DICT) {
    const { data: ins, error } = await sb
      .from("component_mappings")
      .insert({ ...d, active: true })
      .select("id")
      .single();
    if (error) console.log(`⚠ insert dict failed: ${error.message}`);
    else dictIds.push((ins as any).id);
  }
  check("B0. items dictionnaire de test insérés", dictIds.length === 2);

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
        await page.waitForTimeout(2500);
        return;
      } catch {
        /* dev server slow — retry */
      }
    }
    throw new Error("task list page unreachable");
  };
  await goto();

  // ---------------- A. AI FIND ----------------
  const aiBtn = page.locator('[data-testid="ai-find-tilt"]');
  check("A. bouton « AI Find from Energy Study » présent", (await aiBtn.count()) === 1);
  if ((await aiBtn.count()) === 1) {
    // Retry anti-hydration : clic → la bannière résultat doit apparaître.
    let bannerText = "";
    for (let i = 0; i < 3 && !bannerText; i++) {
      await aiBtn.click().catch(() => {});
      // Vrai appel Claude sur un vrai PDF — laisser du temps.
      for (let w = 0; w < 30 && !bannerText; w++) {
        await page.waitForTimeout(2000);
        const el = page.locator('[data-testid="ai-find-result"]');
        if ((await el.count()) > 0) bannerText = (await el.textContent()) ?? "";
      }
    }
    console.log(`   bannière: ${bannerText.slice(0, 140)}`);
    if (hasStudy) {
      check(
        "A. AI Find sur VRAI Energy Study : found ou empty (jamais erreur technique)",
        /AI found:|No tilt angle found/.test(bannerText),
        bannerText.slice(0, 80)
      );
      if (/AI found:/.test(bannerText)) {
        const { data: after } = await sb
          .from("production_task_lists")
          .select("solar_panel_tilt_angle")
          .eq("id", tl.id)
          .maybeSingle();
        check(
          "A. tilt trouvé ÉCRIT en DB",
          (after as any)?.solar_panel_tilt_angle != null,
          `DB=${(after as any)?.solar_panel_tilt_angle}`
        );
      }
    } else {
      check(
        "A. sans étude uploadée : message d'erreur explicite",
        /No Energy Study uploaded/i.test(bannerText),
        bannerText.slice(0, 80)
      );
    }
  }

  // Extraction directe du vrai PDF (preuve extracteur sur document client),
  // même si la TL ciblée n'était pas celle de l'étude.
  const study = ((setups ?? []) as any[])[0];
  if (study?.energy_study_path) {
    const { data: file, error } = await sb.storage
      .from("documents")
      .download(study.energy_study_path);
    if (error || !file) {
      skip(`A2. téléchargement étude réelle impossible (${error?.message})`);
    } else {
      try {
        const ex = await extractLightingFromEnergyStudy({
          pdf: new Uint8Array(await file.arrayBuffer()),
        });
        check(
          "A2. extracteur sur VRAI PDF client : réponse structurée (tilt ou null propre)",
          ex.tilt_angle === null || (ex.tilt_angle >= 0 && ex.tilt_angle <= 90),
          `tilt=${ex.tilt_angle} page=${ex.tilt_source_page} conf=${ex.confidence?.tilt_angle ?? "—"}`
        );
      } catch (e: any) {
        check("A2. extracteur sur VRAI PDF client", false, e?.message);
      }
    }
  }

  // ---------------- B. SPARE PARTS product-aware ----------------
  await goto();
  const addBtn = page.locator('[data-testid="add-spare-part"]');
  for (let i = 0; i < 4; i++) {
    await addBtn.click().catch(() => {});
    await page.waitForTimeout(700);
    if ((await page.locator('[data-testid="spare-part-card"]').count()) > 0) break;
  }
  const card = page.locator('[data-testid="spare-part-card"]').last();
  check("B1. carte spare part riche affichée", (await card.count()) > 0);
  const pick = card.locator('[data-testid="spare-part-pick"]');
  const options = await pick.locator("option").allTextContents();
  check(
    "B2. le sélecteur propose les items du dictionnaire (groupés)",
    options.some((o) => o.includes("E2E Battery 25.6V 65Ah")),
    `${options.length} options`
  );
  const battId = dictIds[0];
  await pick.selectOption(battId).catch(() => {});
  await page.waitForTimeout(500);
  const modelVal = await card.locator('input[placeholder="e.g. LFP25-65AH-V6"]').inputValue();
  check("B3. pick → modèle auto-rempli depuis le dictionnaire", modelVal === "LFP25-65AH-V6", modelVal);
  // Save → snapshot en DB (retry anti-hydration).
  let persisted: any = null;
  for (let i = 0; i < 4 && !persisted; i++) {
    await page.locator('[data-testid="save-industrial-file"]').click().catch(() => {});
    await page.waitForTimeout(3000);
    const { data } = await sb
      .from("production_task_lists")
      .select("industrial_spec")
      .eq("id", tl.id)
      .maybeSingle();
    const parts = ((data as any)?.industrial_spec?.spare_parts ?? []) as any[];
    persisted = parts.find((p) => p.dictionary_item_id === battId) ?? null;
    if (!persisted) await goto();
  }
  check(
    "B4. snapshot dictionnaire PERSISTÉ (dictionary_item_id + factory_name)",
    !!persisted && persisted.factory_name === "LFP25-65AH-V6",
    persisted ? `part=${persisted.part}` : "non trouvé"
  );

  // ---------------- C. ADMIN Industrial dictionary ----------------
  await page.goto(`${BASE}/admin/components`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(1500);
  check(
    "C1. admin : titre « Industrial dictionary »",
    await page.locator('h1:has-text("Industrial dictionary")').isVisible()
  );
  check(
    "C2. admin : hint dormant m160 visible (pré-migration)",
    await page.locator("text=m160").first().isVisible()
  );
  check(
    "C3. admin : les items de test apparaissent",
    await page.locator('input[value="E2E Battery 25.6V 65Ah"]').count() > 0 ||
      (await page.locator("text=E2E Battery 25.6V 65Ah").count()) > 0
  );
  // Non-régression sécurité : le TLM entre dans la SECTION admin (layout
  // assoupli m160) mais les pages master-data restent self-gatées.
  await page.goto(`${BASE}/admin/products`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(1500);
  check(
    "C4. 🔒 TLM sur /admin/products : toujours refusé (self-gate intact)",
    (await page.locator("text=/access denied|don't have access|denied/i").count()) > 0 &&
      (await page.locator('h1:has-text("Products")').count()) === 0
  );
  await ctx.close();
} finally {
  await browser.close();
  // ---------------- D. REVERT ----------------
  const { error: revErr } = await sb
    .from("production_task_lists")
    .update({
      solar_panel_tilt_angle: tl.solar_panel_tilt_angle ?? null,
      pole_drawing_tilt_verified: tl.pole_drawing_tilt_verified ?? false,
      pole_drawing_tilt_verified_by: tl.pole_drawing_tilt_verified_by ?? null,
      pole_drawing_tilt_verified_at: tl.pole_drawing_tilt_verified_at ?? null,
      industrial_spec: tl.industrial_spec ?? {},
    })
    .eq("id", tl.id);
  console.log(revErr ? `⚠ revert TL failed: ${revErr.message}` : "🧹 TL revertée");
  if (dictIds.length) {
    const { error } = await sb.from("component_mappings").delete().in("id", dictIds);
    console.log(error ? `⚠ cleanup dict failed: ${error.message}` : "🧹 items dictionnaire supprimés");
  }
}

console.log(ok ? "\n✅ DICTIONARY + AI FIND VERIFY — PASS" : "\n❌ DICTIONARY + AI FIND VERIFY — FAIL");
process.exit(ok ? 0 : 1);
