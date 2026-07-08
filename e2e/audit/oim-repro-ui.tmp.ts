// =====================================================================
// REPRO/PREUVE — OIM Malanville : les fichiers uploadés remontent-ils à
// nouveau ? Rejoue le pipeline de la page (groupIntoAffairs →
// buildAffairFiles multi-ancres) sous un vrai JWT admin, sur données réelles.
// =====================================================================
import { createClient } from "@supabase/supabase-js";
import {
  groupIntoAffairs,
  buildAffairFiles,
  affairAttachmentAnchors,
  type PrototypeDoc,
  type AffairRecord,
  type AttachmentLite,
} from "../../lib/affairs-prototype.ts";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
);
await sb.auth.signInWithPassword({
  email: process.env.E2E_ADMIN_EMAIL!,
  password: process.env.E2E_PASSWORD!,
});

const OIM = "65755e17-6a3e-4bab-b658-e52c20f7e70b";
const { data: affair } = await sb.from("affairs").select("id, client_id, name, status, owner_id, archived_at").eq("id", OIM).single();
const { data: docsData } = await sb
  .from("documents")
  .select(
    "id, number, client_id, root_document_id, version, affair_name, status, type, date, total_price, currency, forecast_probability, archived_at, affair_id, pdf_url"
  )
  .eq("affair_id", OIM);
const documents = (docsData ?? []) as PrototypeDoc[];

const [group] = groupIntoAffairs(
  documents,
  new Map(),
  new Map(),
  new Map(),
  new Map(),
  new Map(),
  new Map<string, AffairRecord>([[OIM, affair as AffairRecord]])
).flatMap((c) => c.affairs);

console.log(`anchorId=${group.anchorId}`);
console.log(`anchors candidats=${Array.from(affairAttachmentAnchors(group)).map((a) => a.slice(0, 8)).join(", ")}`);

const { data: atts } = await sb
  .from("attachments")
  .select("id, affair_id, file_name, file_size, attachment_type, created_at, uploaded_by");
group.files = buildAffairFiles(group, (atts ?? []) as AttachmentLite[]);

const attFiles = group.files.filter((f) => f.kind === "attachment");
console.log(`\nFichiers affichés dans l'onglet Documents (uploads) : ${attFiles.length}`);
for (const f of attFiles) console.log(`  ✓ ${f.name} (${f.attachmentType})`);
const docFiles = group.files.filter((f) => f.kind === "quotation");
console.log(`Documents commerciaux : ${docFiles.length} (${docFiles.map((f) => f.name).join(", ")})`);

const expected = ["SP8MD-300X300X16-200X89X3.5-60X750-0-TZ251008041.pdf", "SOLUX I Fiche Technique I SSLX Perf 80-FR (Top).pdf"];
const names = new Set(attFiles.map((f) => f.name));
const ok = expected.every((n) => names.has(n));
console.log(ok ? "\n✅ PASS — les documents disparus remontent à nouveau." : "\n❌ FAIL — fichiers attendus toujours absents.");
process.exit(ok ? 0 : 1);
