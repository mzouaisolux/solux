// Import-graph cycle detector. Builds the module graph from a root file,
// following @/, ./ and ../ imports + re-exports, and reports cycles — a
// circular import where a binding is used at module-eval time is a classic
// cause of React "Element type is invalid: got undefined".
//   node --experimental-strip-types e2e/audit/find-cycles.ts "app/(app)/documents/[id]/page.tsx"
import fs from "node:fs";
import path from "node:path";
const ROOT = process.cwd();
const start = path.join(ROOT, process.argv[2]);

function resolve(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = path.join(path.dirname(fromFile), spec);
  else return null; // node_module
  for (const c of [base + ".tsx", base + ".ts", path.join(base, "index.tsx"), path.join(base, "index.ts")]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}
function imports(file: string): string[] {
  const src = fs.readFileSync(file, "utf8");
  const out: string[] = [];
  for (const m of src.matchAll(/(?:import|export)[^;'"]*?from\s*["']([^"']+)["']/g)) {
    const r = resolve(m[1], file);
    if (r) out.push(r);
  }
  return [...new Set(out)];
}

const graph = new Map<string, string[]>();
const stack: string[] = [];
const onStack = new Set<string>();
const visited = new Set<string>();
const cycles: string[][] = [];
const rel = (f: string) => f.replace(ROOT + "/", "");

function dfs(file: string) {
  visited.add(file);
  onStack.add(file);
  stack.push(file);
  if (!graph.has(file)) graph.set(file, imports(file));
  for (const dep of graph.get(file)!) {
    if (onStack.has(dep)) {
      const i = stack.indexOf(dep);
      cycles.push(stack.slice(i).concat(dep).map(rel));
    } else if (!visited.has(dep)) {
      dfs(dep);
    }
  }
  onStack.delete(file);
  stack.pop();
}
dfs(start);

// Dedupe cycles by their set of files.
const seen = new Set<string>();
const uniq = cycles.filter((c) => {
  const k = [...c].sort().join("|");
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});
console.log(`scanned ${visited.size} modules from ${rel(start)}`);
console.log(uniq.length ? `\nCYCLES (${uniq.length}):` : "\nNo import cycles found.");
for (const c of uniq) console.log("  • " + c.join("\n      → "));
