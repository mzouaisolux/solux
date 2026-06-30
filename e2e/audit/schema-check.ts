// =====================================================================
// SCHEMA ↔ CODE CHECK — catches the runtime-42703 class (a column that
// doesn't exist fails at RUNTIME, not compile, because the Supabase client
// is untyped). Parses every known column from supabase/schema.sql +
// migrations, then scans the code for column references that match NO known
// column anywhere (almost always a typo, e.g. documents.total → total_price).
//   node --experimental-strip-types e2e/audit/schema-check.ts        (advisory)
//   FAIL_ON_UNKNOWN=1 node ... e2e/audit/schema-check.ts             (CI gate)
// Conservative by design: skips embedded selects t(a,b), aliases a:b, *,
// and anything non-snake_case, to keep false positives near zero.
// =====================================================================
import fs from "node:fs";
import path from "node:path";
const ROOT = process.cwd();

function walk(dir: string, out: string[], filter: (f: string) => boolean) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".next" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out, filter);
    else if (filter(p)) out.push(p);
  }
}

// ---- 1. Build the universe of known columns from the SQL DDL. ----
const known = new Set<string>(["id", "created_at", "updated_at", "count"]);
const sqlFiles: string[] = [];
for (const d of ["supabase", "supabase/migrations"]) {
  const abs = path.join(ROOT, d);
  if (fs.existsSync(abs)) walk(abs, sqlFiles, (f) => f.endsWith(".sql"));
}
for (const f of sqlFiles) {
  const sql = fs.readFileSync(f, "utf8");
  // create table … ( col type, col type, … )
  for (const m of sql.matchAll(/create table[^(]*\(([\s\S]*?)\n\s*\);/gi)) {
    for (const line of m[1].split("\n")) {
      const mm = line.trim().match(/^"?([a-z][a-z0-9_]*)"?\s+[a-z]/i);
      if (mm && !/^(constraint|primary|foreign|unique|check|references)$/i.test(mm[1])) known.add(mm[1]);
    }
  }
  // alter table … add column [if not exists] col …
  for (const m of sql.matchAll(/add column(?:\s+if not exists)?\s+"?([a-z][a-z0-9_]*)"?/gi)) known.add(m[1]);
  // generated columns / explicit "col" type inside any add
}

// ---- 2. Scan code for column-string references. ----
const codeFiles: string[] = [];
for (const d of ["app", "lib", "components"]) {
  const abs = path.join(ROOT, d);
  if (fs.existsSync(abs)) walk(abs, codeFiles, (f) => /\.tsx?$/.test(f) && !f.includes("/audit/"));
}
const isSimpleCol = (s: string) => /^[a-z][a-z0-9_]*$/.test(s);
type Ref = { col: string; file: string; line: number };
const refs: Ref[] = [];
for (const f of codeFiles) {
  const lines = fs.readFileSync(f, "utf8").split("\n");
  lines.forEach((ln, i) => {
    // .eq("col" / .neq / .order("col" / .is("col" / .gt/.gte/.lt/.lte/.in("col"
    for (const m of ln.matchAll(/\.(?:eq|neq|gt|gte|lt|lte|is|in|order|like|ilike|contains)\(\s*["']([a-z][a-z0-9_]*)["']/g)) {
      if (isSimpleCol(m[1])) refs.push({ col: m[1], file: f, line: i + 1 });
    }
    // .select("a, b, t(x), a:b, *") — only check simple tokens
    for (const m of ln.matchAll(/\.select\(\s*[`"']([^`"']+)[`"']/g)) {
      for (let tok of m[1].split(",")) {
        tok = tok.trim();
        if (tok.includes("(") || tok.includes(":") || tok.includes("*") || tok.includes("!") || tok.includes(".")) continue;
        if (isSimpleCol(tok)) refs.push({ col: tok, file: f, line: i + 1 });
      }
    }
  });
}

// ---- 3. Report references whose column matches NO known column. ----
const rel = (f: string) => f.replace(ROOT + "/", "");
const unknown = refs.filter((r) => !known.has(r.col));
const byCol = new Map<string, Ref[]>();
for (const r of unknown) (byCol.get(r.col) ?? byCol.set(r.col, []).get(r.col)!).push(r);

console.log(`schema-check: ${known.size} known columns from ${sqlFiles.length} SQL files; scanned ${codeFiles.length} code files, ${refs.length} column refs.`);
if (byCol.size === 0) {
  console.log("✅ No unknown column references.");
  process.exit(0);
}
console.log(`\n⚠ ${byCol.size} column name(s) referenced in code but found in NO table DDL (likely typo or missing migration):`);
for (const [col, rs] of [...byCol.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  • "${col}" (${rs.length}×) — e.g. ${rel(rs[0].file)}:${rs[0].line}`);
}
process.exit(process.env.FAIL_ON_UNKNOWN ? 1 : 0);
