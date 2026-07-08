// m159 — verify the Industrial Production File sections inside the captured
// dossiers (install-free, extends the aospro-pdf-text.ts technique):
//   • dossier-m159.pdf     must CONTAIN the new bilingual sections.
//   • dossier-dormant.pdf  must NOT contain them (clean pre-m159 degradation).
//
// @react-pdf embeds every registered font as a subset, so content streams
// hold glyph ids, not unicode — raw substring search finds nothing. We
// therefore decode each Tj/TJ hex run against every ToUnicode CMap in the
// file; a run decoded with its own font's CMap yields the real text, so a
// target string is "present" when ANY CMap's decode contains it.
//
//   node --experimental-strip-types e2e/audit/industrial-dossier-pdf-text.ts
import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";

const OUT = path.join("e2e", ".runs", "m159");

function inflateStreams(raw: string): string[] {
  const out: string[] = [];
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const start = m.index + m[0].length;
    const end = raw.indexOf("endstream", start);
    if (end < 0) continue;
    const chunk = Buffer.from(raw.slice(start, end), "latin1");
    try { out.push(zlib.inflateSync(chunk).toString("latin1")); }
    catch { try { out.push(zlib.inflateRawSync(chunk).toString("latin1")); } catch {} }
  }
  return out;
}

/** Parse one ToUnicode CMap stream → glyphId → unicode string. */
function parseCmap(streamUtf8: string): Map<number, string> {
  const map = new Map<number, string>();
  const hex2str = (h: string) => {
    let s = "";
    for (let i = 0; i + 4 <= h.length; i += 4) s += String.fromCharCode(parseInt(h.slice(i, i + 4), 16));
    return s;
  };
  for (const block of streamUtf8.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      map.set(parseInt(pair[1], 16), hex2str(pair[2]));
    }
  }
  for (const block of streamUtf8.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const tri of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const lo = parseInt(tri[1], 16), hi = parseInt(tri[2], 16), dst = parseInt(tri[3], 16);
      for (let g = lo; g <= hi && g - lo < 65536; g++) map.set(g, String.fromCharCode(dst + (g - lo)));
    }
  }
  return map;
}

function analyze(pdfPath: string) {
  const buf = fs.readFileSync(pdfPath);
  const raw = buf.toString("latin1");
  const streams = inflateStreams(raw);

  const cmaps: Array<Map<number, string>> = [];
  const runs: string[] = []; // hex glyph runs from Tj / TJ operators
  for (const st of streams) {
    const utf8 = Buffer.from(st, "latin1").toString("utf8");
    if (utf8.includes("beginbfchar") || utf8.includes("beginbfrange")) {
      cmaps.push(parseCmap(utf8));
      continue;
    }
    if (!/T[jJ]/.test(st)) continue;
    // <hex> Tj  and  [<hex> -12 <hex> ...] TJ (kerning numbers ignored,
    // hex parts of one TJ concatenated — they belong to the same run).
    for (const mm of st.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) runs.push(mm[1]);
    for (const mm of st.matchAll(/\[((?:<[0-9A-Fa-f]+>|[-\d.\s])+)\]\s*TJ/g)) {
      runs.push([...mm[1].matchAll(/<([0-9A-Fa-f]+)>/g)].map((x) => x[1]).join(""));
    }
  }

  // Decode every run against every CMap — the right font's CMap yields the
  // real text for its own runs.
  const corpora = cmaps.map((cm) =>
    runs
      .map((hex) => {
        let s = "";
        for (let i = 0; i + 4 <= hex.length; i += 4) s += cm.get(parseInt(hex.slice(i, i + 4), 16)) ?? "�";
        return s;
      })
      .join("\n")
  );
  const uni = new Set<string>();
  for (const cm of cmaps) for (const v of cm.values()) for (const c of v) uni.add(c);

  // Case-insensitive: section sub-headers render with textTransform
  // uppercase ("SPARE PARTS"), so compare uppercased.
  const upper = corpora.map((c) => c.toUpperCase());
  const found = (s: string) => {
    const u = s.toUpperCase();
    return upper.some((c) => c.includes(u));
  };
  return { found, uni, size: buf.length, fonts: cmaps.length, runs: runs.length };
}

// ---------- expectations ----------
const M159_ZH = [
  "工业生产规格",       // Industrial Production File (section title)
  "太阳能板倾角",       // Solar Panel Tilt Angle
  "灯杆图纸倾角已核对", // pole drawing checkpoint VERIFIED line
  "灯杆配件",           // Pole Accessories
  "不包含",             // EXCLUDED (nut caps unchecked)
  "包装要求",           // Packaging
  "客户定制包装",       // Customized Client version
  "用户手册",           // User Manual
  "英文", "法文", "阿拉伯文", // EN / FR / AR
  "备品备件",           // Spare Parts
  "工厂命名",           // Factory name column
  "电池组件",           // spare-part factory name (CJK half — the layout
                        // word-splits mixed CJK/Latin runs; "BT-538" is
                        // checked in the Latin list)
  "客户命名",           // customer naming sub-line
];
const M159_LATIN = [
  "Industrial Production File",
  "Solar Panel Tilt Angle",
  "Pole Accessories",
  "EXCLUDED",
  "Anti-theft screws kit",
  "M24 x 800mm",
  "Customized Client version",
  "SOLUX branded manual",
  "Arabic",
  "Spare Parts",
  "SLX-BAT-538",
  "BT-538", // factory naming cell (电池组件 BT-538); not a substring of SLX-BAT-538
  "CTRL-V5",
  "Power pack",
  "Factory Y naming",
  "20°",
];
// Distinctive markers that must be ABSENT from the dormant dossier (倾 tilt,
// 册 manual, 阿/伯 Arabic, 杆 pole — none appears in pre-existing sections).
const DORMANT_ZH_ABSENT = ["倾", "册", "阿", "伯", "杆"];
const DORMANT_LATIN_ABSENT = [
  "Industrial Production File",
  "Solar Panel Tilt Angle",
  "Anti-theft screws kit",
  "SLX-BAT-538",
];

let fails = 0;
const check = (label: string, pass: boolean) => {
  console.log(`  ${pass ? "✓" : "✗ FAIL"} ${label}`);
  if (!pass) fails++;
};

const m159Path = path.join(OUT, "dossier-m159.pdf");
const dormantPath = path.join(OUT, "dossier-dormant.pdf");

if (fs.existsSync(m159Path)) {
  const a = analyze(m159Path);
  console.log(`\n=== dossier-m159.pdf (${a.size} bytes, ${a.fonts} subset fonts, ${a.runs} text runs) — new sections MUST be present ===`);
  for (const s of M159_ZH) check(`zh "${s}"`, a.found(s));
  for (const s of M159_LATIN) check(`latin "${s}"`, a.found(s));
} else {
  console.log("dossier-m159.pdf missing — run industrial-dossier-pdf.ts first");
  fails++;
}

if (fs.existsSync(dormantPath)) {
  const a = analyze(dormantPath);
  console.log(`\n=== dossier-dormant.pdf (${a.size} bytes, ${a.fonts} subset fonts, ${a.runs} text runs) — new sections MUST be absent ===`);
  for (const c of DORMANT_ZH_ABSENT) check(`zh char "${c}" absent`, !a.uni.has(c) && !a.found(c));
  for (const s of DORMANT_LATIN_ABSENT) check(`latin "${s}" absent`, !a.found(s));
} else {
  console.log("dossier-dormant.pdf missing — run industrial-dossier-pdf.ts --dormant first");
  fails++;
}

console.log(fails === 0 ? "\nALL CHECKS PASSED" : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
