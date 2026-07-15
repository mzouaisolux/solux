// =====================================================================
// scripts/import-packing-xlsx.ts — import "packing list all.xlsx" into the
// LOCAL packing_* tables. Standalone, reproducible, non-destructive.
//
//   node --experimental-strip-types scripts/import-packing-xlsx.ts [--fresh]
//     --fresh : dev reset (TRUNCATE packing item/calc tables) then import.
//               Seed tables (containers/config/rules/pole profiles) untouched.
//
// SAFETY: LOCAL Supabase only (host guard). The original file is preserved
// verbatim in packing_import.original_file (bytea) AND kept in the repo at
// data/packing/source/. Imported rows start as DRAFT — never auto-validated.
// Ambiguous data is flagged in packing_import_issue, never silently cleaned.
// =====================================================================
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import ExcelJS from "exceljs";
// `pg` ships no types; load it via a computed specifier so tsc doesn't require
// @types/pg (same convention as scripts/migrate.ts). Stripped at runtime.
const pgModule = "pg";

const SRC = process.argv.find((a) => a.endsWith(".xlsx")) ||
  "data/packing/source/packing_list_all.xlsx";
const FRESH = process.argv.includes("--fresh");
const IMAGES_DIR = "public/packing/images";
const IMAGES_URL = "/packing/images";

const DEFAULT_LOCAL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const DBURL = process.env.PACKING_LOCAL_DB_URL || DEFAULT_LOCAL;
const host = new URL(DBURL).hostname;
if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
  console.error(`REFUSED: "${host}" is not local. Import touches LOCAL Supabase only.`);
  process.exit(2);
}

// ---------------------------------------------------------------------
// Cell parsing helpers
// ---------------------------------------------------------------------
type Cell = ExcelJS.CellValue;

function cellText(v: Cell): string {
  if (v == null) return "";
  if (typeof v === "object") {
    const o = v as any;
    if (o.result !== undefined) return String(o.result);
    if (o.text !== undefined) return String(o.text);
    if (o.richText) return o.richText.map((r: any) => r.text).join("");
    return "";
  }
  return String(v).trim();
}
/** Numeric value of a cell (handles formula .result). null if not numeric. */
function toNum(v: Cell): number | null {
  if (v == null) return null;
  if (typeof v === "number") return v;
  if (typeof v === "object") {
    const o = v as any;
    if (o.result !== undefined) { const n = Number(o.result); return isNaN(n) ? null : n; }
    return null;
  }
  const s = String(v).trim().replace(/,/g, ".");
  const n = Number(s);
  return isNaN(n) ? null : n;
}
const DIA = /[ΦφØø]/;
function hasDiameter(v: Cell): boolean { return DIA.test(cellText(v)); }
function diameterVal(v: Cell): number | null {
  const m = cellText(v).match(/([0-9]+(?:\.[0-9]+)?)/);
  return m ? Number(m[1]) : null;
}
/** Gross weight cell: "4.6/24.45" → {unit:4.6, master:24.45, two:true}. */
function parseGross(v: Cell): { unit: number | null; master: number | null; two: boolean; raw: string } {
  const raw = cellText(v);
  if (raw.includes("/")) {
    const [a, b] = raw.split("/").map((x) => Number(x.trim()));
    return { unit: isNaN(a) ? null : a, master: isNaN(b) ? null : b, two: true, raw };
  }
  return { unit: toNum(v), master: null, two: false, raw };
}
/** "4pcs/carton" → 4 ; "1pc/carton"/"1pcs"/"1set"/"1pc" → 1 ; else null. */
function unitsPerOutside(method: string): number | null {
  const m = method.match(/(\d+)\s*(pcs?|sets?|pc)/i);
  return m ? Number(m[1]) : null;
}
function deriveFamily(ref: string): string | null {
  const R = ref.toUpperCase();
  const fams = ["SSLXPRO", "SSLX", "AOSPRO", "AOS PERF", "AOSPRO+", "AOS", "OPTI", "VDL", "SGL", "COLPRO", "COLARSUN", "SLKPRO", "SLK", "TOTEM+", "TOTEM", "PL0", "PB0", "BW0", "B0", "SL-0", "SL0", "COL"];
  for (const f of fams) if (R.startsWith(f) || R.includes(" " + f)) return f.replace(/[0-9+]+$/, "").trim();
  const m = R.match(/^([A-Z]+)/);
  return m ? m[1] : null;
}
function deriveComponent(ref: string): { name: string | null; type: string } {
  const R = ref.toUpperCase();
  if (/\bPOLE\b|MÂT|MAT\b/.test(R)) return { name: "POLE", type: "pole" };
  if (/\bHEAD\b/.test(R)) return { name: "HEAD", type: "head" };
  if (/\bARM\b/.test(R)) return { name: "ARM", type: "arm" };
  if (/\bANCHOR\b/.test(R)) return { name: "ANCHOR", type: "anchor" };
  if (/\bSLEEVE\b/.test(R)) return { name: "SLEEVE", type: "sleeve" };
  if (/\bBOLT\b|\bNUT\b|\bSCREW\b|\bPLATE\b|\bCAP\b/.test(R)) return { name: "HARDWARE", type: "hardware" };
  if (/\bPV\b|PANEL|组件/.test(R)) return { name: "PANEL", type: "panel" };
  return { name: null, type: "product" };
}

async function main() {
  if (!fs.existsSync(SRC)) { console.error(`source not found: ${SRC}`); process.exit(2); }
  const bytes = fs.readFileSync(SRC);
  const sha = crypto.createHash("sha256").update(bytes).digest("hex");

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as any);
  const ws = wb.worksheets[0];
  const media: any[] = (wb.model as any).media || [];

  const pg: any = (await import(pgModule)).default;
  const client = new pg.Client({ connectionString: DBURL });
  await client.connect();
  console.log(`connected LOCAL @ ${host}; sheet "${ws.name}"; media ${media.length}`);

  try {
    await client.query("begin");

    if (FRESH) {
      await client.query(`truncate
        packing_package, packing_calculation_line, packing_calculation,
        packing_bom_line, packing_bom, packing_import_issue, packing_field_change,
        packing_item_version, packing_product_image, packing_item, packing_import
        restart identity cascade`);
      console.log("… --fresh: packing item/calc tables truncated (seed tables kept)");
    } else {
      const { rows } = await client.query("select count(*)::int n from packing_item");
      if (rows[0].n > 0) {
        console.error(`packing_item already has ${rows[0].n} rows. Re-run with --fresh to reset (dev), or use the re-import UI (Phase 1b).`);
        await client.query("rollback"); await client.end(); process.exit(1);
      }
    }

    // ---- import header (preserve original bytes) --------------------
    const { rows: verRows } = await client.query(
      "select coalesce(max(import_version),0)+1 v from packing_import"
    );
    const importVersion = verRows[0].v;
    const { rows: impRows } = await client.query(
      `insert into packing_import (file_name, file_sha256, original_file, byte_size, import_version, row_count, report)
       values ($1,$2,$3,$4,$5,0,'{}'::jsonb) returning id`,
      [path.basename(SRC), sha, bytes, bytes.length, importVersion]
    );
    const importId: string = impRows[0].id;

    // ---- image anchors: excel row (1-based) → media entry -----------
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
    const rowImage = new Map<number, { path: string; name: string; ext: string }>();
    const imageRows: { row: number; id: number }[] = [];
    for (const img of ws.getImages()) {
      const excelRow = (img.range.tl.nativeRow ?? 0) + 1; // 0-based → 1-based
      imageRows.push({ row: excelRow, id: (img as any).imageId });
    }
    let imagesWritten = 0;
    const imageIdToPath = new Map<number, { path: string; name: string; ext: string }>();
    for (const { row, id } of imageRows) {
      let m = media[id] ?? media[id - 1];
      if (!m || !m.buffer) continue;
      const name = `${m.name || "image" + id}.${m.extension || "png"}`;
      const outPath = path.join(IMAGES_DIR, name);
      if (!imageIdToPath.has(id)) {
        fs.writeFileSync(outPath, m.buffer);
        imagesWritten++;
        imageIdToPath.set(id, { path: `${IMAGES_URL}/${name}`, name, ext: m.extension || "png" });
      }
      // first image wins per row (overlays/badges ignored for the primary link)
      if (!rowImage.has(row)) rowImage.set(row, imageIdToPath.get(id)!);
    }

    // insert one image record per media file actually used, remember its db id
    const mediaDbId = new Map<string, string>(); // storage_path → image row id
    for (const info of new Set([...rowImage.values()].map((v) => v.path))) {
      const meta = [...rowImage.entries()].find(([, v]) => v.path === info)!;
      const srcRow = meta[0];
      const { rows } = await client.query(
        `insert into packing_product_image (storage_path, original_media_name, source, import_id, source_row, assigned)
         values ($1,$2,'excel_import',$3,$4,true) returning id`,
        [info, meta[1].name, importId, srcRow]
      );
      mediaDbId.set(info, rows[0].id);
    }

    // ---- rows → items + draft versions + issues ---------------------
    const issues: any[] = [];
    const items: { row: number; id: string; reference: string; name: string; component: string; family: string | null }[] = [];
    const factor = 200; // config volumetric_factor (seed); recomputed here for the version snapshot
    let lastPrimaryRow = 0;

    const FIRST = 3, LAST = ws.rowCount;
    for (let rn = FIRST; rn <= LAST; rn++) {
      const R = ws.getRow(rn);
      const A = cellText(R.getCell(1).value);
      const B = R.getCell(2).value;
      const cRaw = R.getCell(3).value, dRaw = R.getCell(4).value, eRaw = R.getCell(5).value;
      const fRaw = R.getCell(6).value, gRaw = R.getCell(7).value, hRaw = R.getCell(8).value;
      const method = cellText(R.getCell(9).value);
      const net = toNum(R.getCell(10).value);
      const gross = parseGross(R.getCell(11).value);

      // Skip fully-empty rows.
      const anyDim = [cRaw, dRaw, eRaw, fRaw, gRaw, hRaw].some((c) => cellText(c) !== "");
      if (!A && !anyDim && !method && net == null && !gross.raw) continue;

      const bText = cellText(B); // variant text when col B is not an image
      const linkedToPrev = !A && (anyDim || bText);
      let reference = A;
      let variant: string | null = null;
      if (linkedToPrev) {
        variant = bText || null;
        reference = variant
          ? `«${variant}» (row ${rn})`
          : `(part of row ${lastPrimaryRow}, row ${rn})`;
        issues.push({ row: rn, col: "A", type: "linked_to_previous_row", sev: "info",
          orig: "", msg: `Row ${rn} has no product reference — appears to belong to the product above (row ${lastPrimaryRow}). Imported as a component, needs validation.`,
          interp: reference });
      } else {
        if (bText && bText.length <= 12) variant = bText; // e.g. "60W","100W","M24"
      }
      if (A) lastPrimaryRow = rn;
      if (!reference) reference = `(row ${rn})`;

      // Dimensions — detect Φ / non-numeric / suspicious.
      const dims: Record<string, number | null> = {};
      const colMap: [string, Cell][] = [["inner_l", cRaw], ["inner_w", dRaw], ["inner_h", eRaw], ["outer_l", fRaw], ["outer_w", gRaw], ["outer_h", hRaw]];
      let diameterNote: string | null = null;
      for (const [k, cell] of colMap) {
        const raw = cellText(cell);
        if (raw === "") { dims[k] = null; continue; }
        if (hasDiameter(cell)) {
          const dia = diameterVal(cell);
          diameterNote = `${k}: Φ${dia ?? "?"}mm (diameter, not L×W)`;
          dims[k] = null;
          issues.push({ row: rn, col: k, type: "diameter_symbol", sev: "warning", orig: raw,
            msg: `Dimension "${raw}" uses a diameter symbol (Φ). Round section — diameter ${dia ?? "?"}mm captured in remarks; L/W left blank.`,
            interp: `diameter=${dia ?? "?"}mm` });
          continue;
        }
        const n = toNum(cell);
        if (n == null) {
          dims[k] = null;
          issues.push({ row: rn, col: k, type: "non_numeric_dimension", sev: "warning", orig: raw,
            msg: `Non-numeric dimension "${raw}".`, interp: null });
          continue;
        }
        dims[k] = n;
        if (n > 0 && n < 10) issues.push({ row: rn, col: k, type: "suspicious_dimension", sev: "warning", orig: raw,
          msg: `Suspicious dimension ${n}mm (< 10mm) — likely a typo.`, interp: null });
        if (n > 12000) issues.push({ row: rn, col: k, type: "suspicious_dimension", sev: "warning", orig: raw,
          msg: `Suspicious dimension ${n}mm (> 12m).`, interp: null });
      }

      const comp = deriveComponent(reference);
      const family = deriveFamily(reference);
      const units = unitsPerOutside(method);
      const hasOuter = dims.outer_l != null && dims.outer_w != null && dims.outer_h != null;

      // Pole / oversized detection.
      const innerDims = [dims.inner_l, dims.inner_w, dims.inner_h].filter((x): x is number => x != null);
      const longestInner = innerDims.length ? Math.max(...innerDims) : 0;
      const isPole = comp.type === "pole" || /POLE/i.test(reference) ||
        (longestInner >= 1800 && innerDims.filter((x) => x <= 450).length >= 2);
      const isOversized = longestInner > 2400 || isPole;

      // CBM + volumetric (calculated).
      const cbm = (l: number | null, w: number | null, h: number | null) =>
        l && w && h ? Math.round((l * w * h / 1e9) * 1e6) / 1e6 : null;
      const cbmInner = cbm(dims.inner_l, dims.inner_w, dims.inner_h);
      const cbmOuter = cbm(dims.outer_l, dims.outer_w, dims.outer_h);
      const volW = cbmOuter != null ? Math.round(cbmOuter * factor * 1000) / 1000
        : cbmInner != null ? Math.round(cbmInner * factor * 1000) / 1000 : null;

      // packaging_type
      let ptype = "individual_carton";
      if (isPole) ptype = "loose_cargo";
      else if (hasOuter && (units ?? 1) > 1) ptype = "master_carton";
      else if (hasOuter) ptype = "outside_carton";

      // --- data-quality issues ---
      if (!hasOuter && (units ?? 1) > 1)
        issues.push({ row: rn, col: "F-H", type: "missing_outside_carton", sev: "warning", orig: method,
          msg: `Packing method "${method}" implies ${units}/carton but the outside-carton dimensions are missing.`, interp: null });
      if (net == null) issues.push({ row: rn, col: "J", type: "missing_weight", sev: "info", orig: "", msg: "Net weight missing.", interp: null });
      if (gross.unit == null && gross.master == null) issues.push({ row: rn, col: "K", type: "missing_weight", sev: "info", orig: gross.raw, msg: "Gross weight missing.", interp: null });
      if (gross.two) issues.push({ row: rn, col: "K", type: "two_weights_one_cell", sev: "warning", orig: gross.raw,
        msg: `Gross-weight cell holds two values "${gross.raw}" — interpreted as unit=${gross.unit}kg / master-carton=${gross.master}kg (confirm).`,
        interp: `unit=${gross.unit}; master=${gross.master}` });
      if (!rowImage.has(rn)) issues.push({ row: rn, col: "B", type: "missing_image", sev: "info", orig: "", msg: "No product image anchored to this row.", interp: null });
      if (!A && !linkedToPrev) issues.push({ row: rn, col: "A", type: "empty_reference", sev: "warning", orig: "", msg: "Empty product reference.", interp: null });

      // --- insert item + draft version ---
      const remarksBits: string[] = [];
      if (diameterNote) remarksBits.push(diameterNote);
      const imgPath = rowImage.get(rn)?.path;
      const imgId = imgPath ? mediaDbId.get(imgPath) ?? null : null;

      const { rows: itemRows } = await client.query(
        `insert into packing_item
          (reference, name, family, variant, component_name, component_type,
           is_lamp_pole, is_oversized, image_id, source, import_id, source_row, verification_status)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'excel_import',$10,$11,'unverified') returning id`,
        [reference, A || reference, family, variant, comp.name, comp.type,
         isPole, isOversized, imgId, importId, rn]
      );
      const itemId: string = itemRows[0].id;

      const { rows: verRows2 } = await client.query(
        `insert into packing_item_version
          (item_id, version_no, status, packaging_type, packing_method_raw,
           qty_per_outside_carton,
           inner_l_mm, inner_w_mm, inner_h_mm, outer_l_mm, outer_w_mm, outer_h_mm,
           net_weight_kg, gross_weight_unit_kg, gross_weight_master_kg,
           cbm_inner, cbm_outer, volumetric_weight_kg, volumetric_factor,
           oversized, lamp_pole, remarks, source_change)
         values ($1,1,'draft',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,'excel_import')
         returning id`,
        [itemId, ptype, method || null, units,
         dims.inner_l, dims.inner_w, dims.inner_h, dims.outer_l, dims.outer_w, dims.outer_h,
         net, gross.unit, gross.master, cbmInner, cbmOuter, volW, factor,
         isOversized, isPole, remarksBits.join("; ") || null]
      );
      await client.query("update packing_item set current_version_id=$1 where id=$2", [verRows2[0].id, itemId]);

      items.push({ row: rn, id: itemId, reference, name: A || reference, component: comp.type, family });
    }

    // ---- duplicates (post-pass) -------------------------------------
    const byRef = new Map<string, number[]>();
    const byName = new Map<string, number[]>();
    for (const it of items) {
      if (it.reference) { const k = it.reference.trim().toUpperCase(); byRef.set(k, [...(byRef.get(k) ?? []), it.row]); }
      if (it.name) { const k = it.name.trim().toUpperCase(); byName.set(k, [...(byName.get(k) ?? []), it.row]); }
    }
    for (const [ref, rowsD] of byRef) if (rowsD.length > 1 && !ref.startsWith("("))
      issues.push({ row: rowsD[0], col: "A", type: "duplicate_reference", sev: "warning", orig: ref,
        msg: `Reference "${ref}" appears on rows ${rowsD.join(", ")} — names are not unique keys (using stable UUIDs).`, interp: null });
    for (const [nm, rowsD] of byName) if (rowsD.length > 1 && byRef.get(nm) == null && !nm.startsWith("("))
      issues.push({ row: rowsD[0], col: "A", type: "duplicate_name", sev: "info", orig: nm,
        msg: `Product name "${nm}" appears on rows ${rowsD.join(", ")}.`, interp: null });

    // ---- BOM proposals (needs_validation): HEAD + POLE adjacency ----
    let bomCount = 0;
    for (let i = 0; i < items.length - 1; i++) {
      const a = items[i], b = items[i + 1];
      const baseA = a.reference.toUpperCase().replace(/\bHEAD\b/, "").trim();
      const baseB = b.reference.toUpperCase().replace(/\bPOLE\b/, "").trim();
      if (/\bHEAD\b/.test(a.reference.toUpperCase()) && /\bPOLE\b/.test(b.reference.toUpperCase()) && baseA && baseA === baseB) {
        const { rows: bom } = await client.query(
          `insert into packing_bom (product_item_id, version_no, status, notes)
           values ($1,1,'needs_validation',$2) returning id`,
          [a.id, `Inferred from adjacent HEAD (row ${a.row}) + POLE (row ${b.row}). Confirm components & options.`]
        );
        await client.query(
          `insert into packing_bom_line (bom_id, component_item_id, component_label, qty_per_product, mandatory, depends_on_option, needs_validation, notes)
           values ($1,$2,$3,1,true,null,true,'head carton'),($1,$4,$5,1,false,'pole',true,'pole — optional per project')`,
          [bom[0].id, a.id, a.reference, b.id, b.reference]
        );
        bomCount++;
        issues.push({ row: a.row, col: "A", type: "bom_needs_validation", sev: "info", orig: a.reference,
          msg: `Packaging BOM proposed: ${a.reference} = head + pole (${b.reference}). Adjacency-inferred — needs Operations validation.`, interp: null });
      }
    }

    // ---- pole-profile discrepancy surfaced as an import issue -------
    issues.push({ row: null, col: null, type: "pole_layer_discrepancy", sev: "warning", orig: "40HQ 8m 300mm flange",
      msg: "Word §IV.1: '16 pcs/level × max 9 levels, max 150 pcs/case' — but 16×9 = 144 ≠ 150. Do not assume 150 is correct; Operations must validate (see packing_pole_profile).",
      interp: "144 (math) vs 150 (stated)" });

    // ---- persist issues ---------------------------------------------
    for (const is of issues) {
      let itemId: string | null = null;
      if (is.row != null) { const it = items.find((x) => x.row === is.row); itemId = it?.id ?? null; }
      await client.query(
        `insert into packing_import_issue
          (import_id, source_row, item_id, column_ref, issue_type, severity, original_value, detected_message, proposed_interpretation)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [importId, is.row, itemId, is.col, is.type, is.sev, is.orig || null, is.msg, is.interp]
      );
    }

    // ---- report ------------------------------------------------------
    const issueByType: Record<string, number> = {};
    for (const is of issues) issueByType[is.type] = (issueByType[is.type] ?? 0) + 1;
    const report = {
      imported_at: new Date().toISOString(),
      source_file: path.basename(SRC),
      sha256: sha,
      import_version: importVersion,
      rows_scanned: LAST - FIRST + 1,
      items_created: items.length,
      images_written: imagesWritten,
      image_records: mediaDbId.size,
      rows_with_image: rowImage.size,
      bom_proposals: bomCount,
      issues_total: issues.length,
      issues_by_type: issueByType,
      poles_detected: items.filter((it) => it.component === "pole").length,
      note: "All items imported as DRAFT (never auto-validated). Original file preserved verbatim in packing_import.original_file.",
    };
    await client.query("update packing_import set row_count=$1, report=$2 where id=$3",
      [items.length, JSON.stringify(report), importId]);

    await client.query("commit");
    console.log("\n✅ import committed");
    console.table([report]);
    console.log("issues by type:", issueByType);
  } catch (e: any) {
    await client.query("rollback").catch(() => {});
    console.error("FAILED (rolled back):", e.message);
    console.error(e.stack);
    await client.end();
    process.exit(1);
  }
  await client.end();
}
main();
