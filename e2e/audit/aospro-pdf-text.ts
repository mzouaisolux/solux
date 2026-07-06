// Install-free PDF text inspection: inflate FlateDecode streams and check
// whether the Chinese source text is recoverable (ToUnicode) or corrupted.
//   node --experimental-strip-types e2e/audit/aospro-pdf-text.ts
import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";
const PDF = path.join("e2e", ".runs", "aospro", "factory.pdf");
const buf = fs.readFileSync(PDF);

// The Chinese strings we entered (source of truth).
const CN = [
  "产品型号", "AOS PRO Plus 测试", "太阳能板", "电池盒", "铝合金电池盒", "磷酸铁锂",
  "控制器设置", "智能调光模式", "光学配光", "灯体颜色", "深灰色", "色温", "中性白",
  "工厂说明", "请按照生产图纸确认所有配件", "卡口", "备注", "这是一个PDF中文字符测试",
  "包装要求", "纸箱包装", "防水保护",
];
// Latin control strings that SHOULD extract fine.
const LATIN = ["AOSPRO+60", "18V/105W", "538Wh", "TY-105W", "PTL-SLX-TAP-26-002", "VALIDATED", "TEST CLIENT AOSPROPLUS"];

// Inflate every stream ... endstream we can.
const raw = buf.toString("latin1");
let inflated = "";
let count = 0, ok = 0;
const re = /stream\r?\n/g; let m: RegExpExecArray | null;
while ((m = re.exec(raw))) {
  const start = m.index + m[0].length;
  const end = raw.indexOf("endstream", start);
  if (end < 0) continue;
  count++;
  const chunk = Buffer.from(raw.slice(start, end), "latin1");
  try { inflated += zlib.inflateSync(chunk).toString("latin1") + "\n"; ok++; }
  catch { try { inflated += zlib.inflateRawSync(chunk).toString("latin1") + "\n"; ok++; } catch {} }
}
console.log(`streams: ${count}, inflated: ${ok}, inflated bytes: ${inflated.length}`);

// Decode inflated bytes as UTF-8 too (in case any text is stored as UTF-8/UTF-16).
const infBuf = Buffer.from(inflated, "latin1");
const asUtf8 = infBuf.toString("utf8");

// 1) Are ToUnicode CMaps present? Collect all bfchar/bfrange unicode targets.
const bf = [...asUtf8.matchAll(/beginbfchar([\s\S]*?)endbfchar/g), ...asUtf8.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)].map((x) => x[1]).join(" ");
const uni = new Set<string>();
for (const hx of bf.matchAll(/<([0-9A-Fa-f]{4,})>/g)) {
  const h = hx[1];
  for (let i = 0; i + 4 <= h.length; i += 4) uni.add(String.fromCharCode(parseInt(h.slice(i, i + 4), 16)));
}
const toUni = [...uni].join("");
console.log(`ToUnicode distinct codepoints: ${uni.size}`);

// 2) Which Chinese chars appear ANYWHERE (streams or ToUnicode)?
const haystacks = { inflatedUtf8: asUtf8, toUnicode: toUni, rawFile: buf.toString("utf8") };
console.log("\n--- CHINESE recoverability (does each source substring appear?) ---");
for (const s of CN) {
  const where = Object.entries(haystacks).filter(([, h]) => h.includes(s)).map(([k]) => k);
  console.log(`  ${where.length ? "✓" : "✗"} "${s}" ${where.length ? "→ " + where.join(",") : "NOT FOUND anywhere"}`);
}
console.log("\n--- LATIN control (should be found) ---");
for (const s of LATIN) {
  const where = Object.entries(haystacks).filter(([, h]) => h.includes(s)).map(([k]) => k);
  console.log(`  ${where.length ? "✓" : "✗"} "${s}" ${where.length ? "→ " + where.join(",") : "NOT FOUND"}`);
}
// Count how many individual CJK codepoints are present in ToUnicode.
const allCjkSource = [...new Set([...CN.join("")].filter((c) => c.charCodeAt(0) >= 0x3000))];
const inToUni = allCjkSource.filter((c) => uni.has(c));
console.log(`\nCJK codepoints entered: ${allCjkSource.length}; present in ToUnicode map: ${inToUni.length}`);
