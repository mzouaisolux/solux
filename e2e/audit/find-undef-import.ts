// Static resolver: BFS over "@/..." imports from a root file; flag any
// named/default import whose target module does NOT export that name
// (the cause of React "Element type is invalid: got undefined").
//   node --experimental-strip-types e2e/audit/find-undef-import.ts "app/(app)/documents/[id]/page.tsx"
import fs from "node:fs";
import path from "node:path";
const ROOT = process.cwd();
const start = process.argv[2];

function resolve(spec: string): string | null {
  if (!spec.startsWith("@/")) return null;
  const base = path.join(ROOT, spec.slice(2));
  for (const c of [base + ".tsx", base + ".ts", path.join(base, "index.tsx"), path.join(base, "index.ts")]) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}
function exportsName(src: string, name: string): boolean {
  if (new RegExp(`export\\s+(async\\s+)?(function|const|class|let|var)\\s+${name}\\b`).test(src)) return true;
  if (new RegExp(`export\\s+(type|interface)\\s+${name}\\b`).test(src)) return true; // type-only, harmless
  // export { a, b as name, ... }
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    const names = m[1].split(",").map((s) => s.trim().split(/\s+as\s+/).pop()!.trim());
    if (names.includes(name)) return true;
  }
  if (/export\s*\*\s*from/.test(src)) return true; // wildcard re-export — can't verify, assume ok
  return false;
}
function hasDefault(src: string): boolean {
  return /export\s+default\b/.test(src) || /export\s*\{[^}]*\bdefault\b[^}]*\}/.test(src);
}

const seen = new Set<string>();
const queue: string[] = [path.join(ROOT, start)];
const problems: string[] = [];
while (queue.length) {
  const file = queue.shift()!;
  if (seen.has(file) || !fs.existsSync(file)) continue;
  seen.add(file);
  const src = fs.readFileSync(file, "utf8");
  const rel = file.replace(ROOT + "/", "");
  // import ... from "@/..."
  for (const m of src.matchAll(/import\s+([^"';]+?)\s+from\s+["'](@\/[^"']+)["']/g)) {
    const clause = m[1].trim();
    const target = resolve(m[2]);
    if (!target) continue;
    const tsrc = fs.readFileSync(target, "utf8");
    // default part
    const defMatch = clause.match(/^([A-Za-z0-9_]+)\s*(,|$)/);
    if (defMatch && !clause.startsWith("{") && !clause.startsWith("type ")) {
      if (!hasDefault(tsrc)) problems.push(`${rel}: default import '${defMatch[1]}' but ${m[2]} has NO default export`);
    }
    // named part { ... }
    const named = clause.match(/\{([^}]*)\}/);
    if (named) {
      for (let n of named[1].split(",")) {
        n = n.trim();
        if (!n || n.startsWith("type ")) continue;
        const orig = n.split(/\s+as\s+/)[0].trim();
        if (!exportsName(tsrc, orig)) problems.push(`${rel}: named import '{ ${orig} }' but ${m[2]} does NOT export it`);
      }
    }
    // recurse into component/app modules
    if (/\/(components|app)\//.test(target)) queue.push(target);
  }
}
console.log(problems.length ? "POTENTIAL UNDEFINED IMPORTS:\n  " + problems.join("\n  ") : "No unresolved @/ named/default imports found in the tree.");
console.log(`\n(scanned ${seen.size} files)`);
