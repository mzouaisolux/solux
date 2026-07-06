// =====================================================================
// check:capabilities — verify the capability catalog (lib/capabilities.ts)
// is the complete, exact source of truth for the Permissions matrix.
//
//   node --experimental-strip-types e2e/audit/capabilities-check.ts
//   FAIL_ON_DEAD=1 …   also fail when a catalogued key is unused in code
//
// It scans every permission call in the codebase —
//   requireCapability / requireCapabilityOrAdmin / hasCapability /
//   hasUiCapability / canAccessOrAdmin — and cross-checks the catalog:
//
//   • ORPHAN  = enforced in code but NOT catalogued → the capability would be
//     invisible in the matrix. FAIL. (The derived `Capability` union already
//     makes this a compile error; this is belt-and-suspenders.)
//   • DEAD    = catalogued but never enforced → "a capability displayed that
//     no longer exists". Reported (fail only with FAIL_ON_DEAD).
//   • DUP     = same key twice in the catalog. FAIL.
//
// Because the matrix renders straight from the catalog, "every registered
// capability is visible" and "future capabilities appear automatically" hold
// by construction — this script guards the two edges (orphan / stale).
// =====================================================================
import fs from "node:fs";
import path from "node:path";
import {
  CAPABILITY_CATALOG,
  ALL_CAPABILITY_KEYS,
  groupCapabilities,
} from "../../lib/capabilities.ts";

const ROOTS = ["app", "lib", "components"];
const PERM_FNS = [
  "requireCapability",
  "requireCapabilityOrAdmin",
  "hasCapability",
  "hasUiCapability",
  "canAccessOrAdmin",
];
const CATALOG_FILE = path.resolve("lib/capabilities.ts");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "node_modules" && !e.name.startsWith(".")) walk(p, out);
    } else if (/\.(ts|tsx)$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

// A permission-fn call and its argument list (until the first ")"), then every
// quoted string inside that looks like a capability key (contains a ".").
const callRe = new RegExp(`\\b(?:${PERM_FNS.join("|")})\\s*\\(([^)]*)\\)`, "g");
const strRe = /"([^"]+)"|'([^']+)'/g;

const usedBy = new Map<string, Set<string>>(); // key → files
for (const root of ROOTS) {
  if (!fs.existsSync(root)) continue;
  for (const file of walk(root)) {
    if (path.resolve(file) === CATALOG_FILE) continue;
    const src = fs.readFileSync(file, "utf8");
    let m: RegExpExecArray | null;
    while ((m = callRe.exec(src)) !== null) {
      const args = m[1];
      let s: RegExpExecArray | null;
      strRe.lastIndex = 0;
      while ((s = strRe.exec(args)) !== null) {
        const key = s[1] ?? s[2];
        if (key && key.includes(".")) {
          if (!usedBy.has(key)) usedBy.set(key, new Set());
          usedBy.get(key)!.add(path.relative(process.cwd(), file));
        }
      }
    }
  }
}

const catalog = new Set<string>(ALL_CAPABILITY_KEYS as readonly string[]);
const used = new Set<string>(usedBy.keys());

// duplicates in the catalog
const seen = new Set<string>();
const dups: string[] = [];
for (const c of CAPABILITY_CATALOG) {
  if (seen.has(c.key)) dups.push(c.key);
  seen.add(c.key);
}

const orphans = [...used].filter((k) => !catalog.has(k)).sort();
const dead = [...catalog].filter((k) => !used.has(k)).sort();

const groups = groupCapabilities();
console.log(
  `\n=== check:capabilities ===\n` +
    `catalogued: ${catalog.size} · used in code: ${used.size} · modules: ${groups.length}`
);
console.log(
  "modules: " + groups.map((g) => `${g.label}(${g.caps.length})`).join(" · ")
);

if (dups.length) {
  console.error(`\n✗ DUPLICATE catalog keys (${dups.length}): ${dups.join(", ")}`);
}
if (orphans.length) {
  console.error(`\n✗ ORPHAN capabilities enforced in code but NOT catalogued (${orphans.length}):`);
  for (const k of orphans) {
    console.error(`   • ${k}   — used in: ${[...(usedBy.get(k) ?? [])].join(", ")}`);
  }
  console.error(`   → add these to CAPABILITY_CATALOG in lib/capabilities.ts.`);
}
if (dead.length) {
  console.warn(`\n⚠ UNUSED catalog keys — not enforced by any permission call (${dead.length}):`);
  for (const k of dead) console.warn(`   • ${k}`);
  console.warn(`   → verify these are still needed (forward-seeded?) or remove them.`);
}

const failed =
  dups.length > 0 ||
  orphans.length > 0 ||
  (process.env.FAIL_ON_DEAD === "1" && dead.length > 0);

if (failed) {
  console.error(`\n✗ FAIL — capability catalog is out of sync.`);
  process.exit(1);
} else {
  console.log(
    `\n✓ PASS — every enforced capability is catalogued (0 orphan, 0 duplicate).` +
      (dead.length ? ` ${dead.length} unused key(s) reported above.` : "")
  );
}
