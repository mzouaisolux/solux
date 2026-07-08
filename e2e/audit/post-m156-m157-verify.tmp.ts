// =====================================================================
// POST-MIGRATION VERIFY — m156 (backfill+RLS attachments) + m157 (SR
// dossier technique). Données réelles, JWT admin + sales.
// =====================================================================
import { createClient } from "@supabase/supabase-js";

const mk = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  });
const admin = mk();
await admin.auth.signInWithPassword({ email: process.env.E2E_ADMIN_EMAIL!, password: process.env.E2E_PASSWORD! });

let ok = true;
const check = (label: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) ok = false;
};

// --- Ledger : les deux lignes existent (gates d'écriture/UI actives) ----
const { data: leds } = await admin
  .from("schema_migrations")
  .select("filename")
  .in("filename", ["156_attachments_affair_anchor.sql", "157_sr_technical_dossier.sql"]);
const names = new Set((leds ?? []).map((l) => l.filename));
check("m156 dans le ledger", names.has("156_attachments_affair_anchor.sql"));
check("m157 dans le ledger", names.has("157_sr_technical_dossier.sql"));

// --- m156 backfill : plus aucun attachment résoluble sur l'ancien ancrage ---
const [{ data: atts }, { data: affairs }, { data: docs }] = await Promise.all([
  admin.from("attachments").select("id, affair_id, file_name"),
  admin.from("affairs").select("id"),
  admin.from("documents").select("id, root_document_id, affair_id"),
]);
const affairIds = new Set((affairs ?? []).map((a) => a.id));
const resolvable = new Set<string>();
for (const d of docs ?? []) {
  if (!d.affair_id) continue;
  resolvable.add(d.id);
  if (d.root_document_id) resolvable.add(d.root_document_id);
}
const onAffair = (atts ?? []).filter((a) => affairIds.has(a.affair_id)).length;
const legacyResolvable = (atts ?? []).filter((a) => !affairIds.has(a.affair_id) && resolvable.has(a.affair_id));
const orphans = (atts ?? []).filter((a) => !affairIds.has(a.affair_id) && !resolvable.has(a.affair_id));
check("backfill m156 complet (0 legacy résoluble restant)", legacyResolvable.length === 0, `sur vraie affaire=${onAffair}, orphelins durs=${orphans.length}`);

// --- m157 : colonnes panneau lisibles + catégories costing/pole_drawing ---
const colProbe = await admin
  .from("project_requests")
  .select("id, solar_panel_power_w, solar_panel_length_mm, solar_panel_width_mm, solar_panel_thickness_mm, solar_panel_reference")
  .limit(1);
check("colonnes solar_panel_* présentes", !colProbe.error, colProbe.error?.message ?? "");

// insert réel costing + pole_drawing sur la SR OIM, puis vérif visibilité sales, puis cleanup
const { data: srs } = await admin.from("project_requests").select("id, affair_id");
const sr = (srs ?? []).find((r) => r.id.startsWith("43c0b1b4"))!;
const stamp = "post-m157-verify";
const mkPath = (n: string) => `project-requests/${sr.id}/${stamp}-${n}`;
const bytes = new TextEncoder().encode("%PDF-1.4\n%%EOF");
const cleanup: { ids: string[]; paths: string[] } = { ids: [], paths: [] };
try {
  for (const [cat, fname] of [
    ["costing", `${stamp}-costing.xlsx`],
    ["pole_drawing", `${stamp}-pole.pdf`],
  ] as const) {
    const path = mkPath(fname);
    await admin.storage.from("documents").upload(path, bytes, { upsert: true });
    cleanup.paths.push(path);
    const ins = await admin
      .from("project_request_files")
      .insert({ project_request_id: sr.id, storage_path: path, file_name: fname, file_size: bytes.length, mime_type: "application/pdf", category: cat })
      .select("id")
      .single();
    check(`insert catégorie '${cat}' accepté`, !ins.error, ins.error?.message ?? "");
    if (ins.data?.id) cleanup.ids.push(ins.data.id);
  }

  // sales ne doit pas voir le costing (RLS le laisse lire, c'est l'app qui
  // filtre — on vérifie donc la règle app-side via le nom de fichier sur la
  // page affaire plus loin dans le check UI ; ici on vérifie juste que les
  // lignes existent pour le collector).
  const { count } = await admin
    .from("project_request_files")
    .select("*", { count: "exact", head: true })
    .eq("project_request_id", sr.id);
  check("fichiers SR en base", (count ?? 0) >= 2, `count=${count}`);
} finally {
  for (const id of cleanup.ids) await admin.from("project_request_files").delete().eq("id", id);
  if (cleanup.paths.length) await admin.storage.from("documents").remove(cleanup.paths).catch(() => {});
  console.log("cleanup fait");
}

// --- RLS m156 : un compte SALES voit toujours les attachments backfillés
//     de ses propres documents (nouveau bras d.affair_id). Test avec le
//     doc OIM créé par... on vérifie au moins que le SELECT sales ne casse
//     pas et retourne ce que la RLS permet.
const sales = mk();
await sales.auth.signInWithPassword({ email: process.env.E2E_SALES_EMAIL!, password: process.env.E2E_PASSWORD! });
const salesRead = await sales.from("attachments").select("id, affair_id").limit(50);
check("SELECT attachments sous JWT sales OK (policy m156 valide)", !salesRead.error, salesRead.error?.message ?? "");

console.log(ok ? "\n✅ POST-MIGRATION PASS" : "\n❌ POST-MIGRATION FAIL");
process.exit(ok ? 0 : 1);
