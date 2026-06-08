"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { parseCSV } from "@/lib/csv";
import { listSheetNames, matchSheet, readAllSheets, readSheet } from "@/lib/xlsx";
import {
  importProducts,
  importPrices,
  importOptions,
  type ProductImportRow,
  type PriceImportRow,
  type OptionImportRow,
  type ImportResult,
} from "../actions";

type Tab = "products" | "prices" | "options" | "all";

const TEMPLATES: Record<Exclude<Tab, "all">, string> = {
  products: `sku,name,category,image_url,cost,active
STR-60,SOLUX Street 60W,Street lighting,,95,TRUE
GRD-20,SOLUX Garden 20W,Garden lighting,,42,TRUE
`,
  prices: `sku,pricing_tier,price,valid_from
STR-60,high,210,2026-04-23
STR-60,medium,180,2026-04-23
STR-60,low,150,2026-04-23
GRD-20,medium,95,2026-04-23
`,
  options: `sku,option_type,option_value,price_modifier
STR-60,CCT,3000K,0
STR-60,CCT,4000K,0
STR-60,CCT,5700K,5
STR-60,Bracket,Single arm,15
STR-60,Bracket,Double arm,28
`,
};

const PRODUCT_ALIASES: Record<string, string[]> = {
  sku: ["sku", "ref", "reference", "code"],
  name: ["name", "product", "product name"],
  category: ["category", "cat"],
  image_url: ["image", "image_url", "image url", "picture"],
  cost_price: ["cost", "cost_price", "cost price"],
  active: ["active", "enabled", "status"],
};
const PRICE_ALIASES: Record<string, string[]> = {
  sku: ["sku", "ref", "reference", "code"],
  pricing_tier: ["pricing_tier", "tier", "pricing tier"],
  price: ["price", "amount"],
  valid_from: ["valid_from", "valid from", "date", "from"],
};
const OPTION_ALIASES: Record<string, string[]> = {
  sku: ["sku", "ref", "reference", "code"],
  option_type: ["option_type", "type", "option type"],
  option_value: ["option_value", "value", "option value"],
  price_modifier: ["price_modifier", "modifier", "price modifier", "adjustment"],
};

function matchHeader(header: string, aliases: Record<string, string[]>) {
  const h = header.trim().toLowerCase();
  for (const [field, alts] of Object.entries(aliases)) {
    if (alts.includes(h)) return field;
  }
  return null;
}

function parseNumberCell(cell: string): number | undefined {
  if (cell === "") return undefined;
  const n = Number(cell.replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

function parseBoolCell(cell: string): boolean | undefined {
  const v = cell.trim().toLowerCase();
  if (v === "") return undefined;
  if (["true", "yes", "y", "1", "active"].includes(v)) return true;
  if (["false", "no", "n", "0", "inactive"].includes(v)) return false;
  return undefined;
}

// ---- row parsers (shared by per-tab and All tab) ----

function parseProductRow(obj: Record<string, string>): {
  row: ProductImportRow;
  error?: string;
} {
  const sku = (obj.sku ?? "").trim();
  if (!sku)
    return { row: { sku: "" } as ProductImportRow, error: "missing sku" };
  const cost = parseNumberCell(obj.cost_price ?? "");
  const active = parseBoolCell(obj.active ?? "");
  return {
    row: {
      sku,
      name: obj.name,
      category: obj.category ?? null,
      image_url: obj.image_url ?? null,
      cost_price: cost,
      active,
    },
  };
}

function parsePriceRow(obj: Record<string, string>): {
  row: PriceImportRow;
  error?: string;
} {
  const sku = (obj.sku ?? "").trim();
  if (!sku) return { row: {} as PriceImportRow, error: "missing sku" };
  const tier = (obj.pricing_tier ?? "").toLowerCase();
  if (tier !== "high" && tier !== "medium" && tier !== "low") {
    return {
      row: { sku } as PriceImportRow,
      error: "tier must be high/medium/low",
    };
  }
  const price = parseNumberCell(obj.price ?? "");
  if (price === undefined || price < 0) {
    return {
      row: { sku, pricing_tier: tier as any } as PriceImportRow,
      error: "invalid price",
    };
  }
  return {
    row: {
      sku,
      pricing_tier: tier as "high" | "medium" | "low",
      price,
      valid_from: obj.valid_from || undefined,
    },
  };
}

function parseOptionRow(obj: Record<string, string>): {
  row: OptionImportRow;
  error?: string;
} {
  const sku = (obj.sku ?? "").trim();
  if (!sku) return { row: {} as OptionImportRow, error: "missing sku" };
  const type = (obj.option_type ?? "").trim();
  const value = (obj.option_value ?? "").trim();
  if (!type || !value) {
    return {
      row: { sku } as OptionImportRow,
      error: "option_type and option_value required",
    };
  }
  const mod = parseNumberCell(obj.price_modifier ?? "") ?? 0;
  return {
    row: { sku, option_type: type, option_value: value, price_modifier: mod },
  };
}

// ---- grid parsing shared by CSV & XLSX paths ----

function parseGrid<T>(
  grid: string[][],
  aliases: Record<string, string[]>,
  requiredKeys: string[],
  parseRow: (obj: Record<string, string>) => { row: T; error?: string }
):
  | { ok: true; rows: Preview<T>[] }
  | { ok: false; error: string } {
  if (grid.length === 0) return { ok: false, error: "Empty file/sheet" };
  const header = grid[0];
  const mapping = header.map((h) => matchHeader(h, aliases));
  for (const req of requiredKeys) {
    if (!mapping.includes(req)) {
      return { ok: false, error: `Missing required column "${req}"` };
    }
  }
  const rows: Preview<T>[] = [];
  for (let i = 1; i < grid.length; i++) {
    const cells = grid[i];
    if (cells.every((c) => !c || c.trim() === "")) continue; // blank line
    const obj: Record<string, string> = {};
    mapping.forEach((field, idx) => {
      if (field) obj[field] = (cells[idx] ?? "").trim();
    });
    const { row, error } = parseRow(obj);
    rows.push({ raw: cells, parsed: row, valid: !error, error });
  }
  if (rows.length === 0)
    return { ok: false, error: "No data rows after the header" };
  return { ok: true, rows };
}

// ---- file reading: detect CSV vs XLSX ----

function isXlsxFile(file: File): boolean {
  return (
    file.name.toLowerCase().endsWith(".xlsx") ||
    file.type ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
}

async function readAsGrid(
  file: File,
  sheetName: string
): Promise<{ ok: true; grid: string[][] } | { ok: false; error: string }> {
  if (isXlsxFile(file)) {
    const available = await listSheetNames(file);
    const actual = matchSheet(available, sheetName);
    if (!actual) {
      return {
        ok: false,
        error: `Missing sheet "${sheetName}". Workbook has: ${available.join(", ") || "(none)"}`,
      };
    }
    return { ok: true, grid: await readSheet(file, actual) };
  }
  const text = await file.text();
  return { ok: true, grid: parseCSV(text) };
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

type Preview<T> = {
  raw: string[];
  parsed: T;
  valid: boolean;
  error?: string;
};

const ACCEPT_BOTH = ".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const ACCEPT_XLSX_ONLY = ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// ===================================================================
//                          Generic Import Tab
// ===================================================================

function ImportTab<T>({
  description,
  templateName,
  templateCsv,
  aliases,
  parseRow,
  runImport,
  headers,
  renderCells,
  requiredKeys,
  sheetName,
}: {
  description: React.ReactNode;
  templateName: string;
  templateCsv: string;
  aliases: Record<string, string[]>;
  parseRow: (obj: Record<string, string>) => { row: T; error?: string };
  runImport: (rows: T[]) => Promise<ImportResult>;
  headers: string[];
  renderCells: (row: T) => React.ReactNode[];
  requiredKeys: string[];
  sheetName: string;
}) {
  const router = useRouter();
  const [filename, setFilename] = useState<string | null>(null);
  const [rows, setRows] = useState<Preview<T>[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleFile(file: File) {
    setError(null);
    setResult(null);
    setRows(null);
    setFilename(file.name);

    const read = await readAsGrid(file, sheetName);
    if (!read.ok) {
      setError(read.error);
      return;
    }
    const parsed = parseGrid<T>(read.grid, aliases, requiredKeys, parseRow);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setRows(parsed.rows);
  }

  function handleImport() {
    if (!rows) return;
    const payload = rows.filter((r) => r.valid).map((r) => r.parsed);
    if (!payload.length) {
      setError("No valid rows to import.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const res = await runImport(payload);
        setResult(res);
        router.refresh();
      } catch (e: any) {
        setError(e?.message ?? "Import failed");
      }
    });
  }

  const validCount = rows?.filter((r) => r.valid).length ?? 0;
  const invalidCount = rows?.filter((r) => !r.valid).length ?? 0;

  return (
    <div className="space-y-4">
      <section className="rounded-lg border bg-white p-5 space-y-3">
        <h2 className="text-lg font-semibold">1. Prepare the file</h2>
        {description}
        <div className="flex items-center gap-4 text-sm">
          <button
            type="button"
            onClick={() => downloadCsv(templateName, templateCsv)}
            className="text-solux-dark hover:underline"
          >
            Download CSV template
          </button>
          <span className="text-xs text-neutral-500">
            Excel works too — use a sheet named <code>{sheetName}</code>.
          </span>
        </div>
      </section>

      <section className="rounded-lg border bg-white p-5 space-y-3">
        <h2 className="text-lg font-semibold">2. Upload</h2>
        <input
          type="file"
          accept={ACCEPT_BOTH}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
          className="block w-full text-sm"
        />
        {filename && (
          <p className="text-xs text-neutral-500">
            Selected: <b>{filename}</b>
          </p>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </section>

      {rows && (
        <section className="rounded-lg border bg-white p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">3. Preview</h2>
            <div className="text-sm">
              <span className="text-emerald-700 font-medium">
                {validCount} ready
              </span>
              {invalidCount > 0 && (
                <span className="text-red-600 ml-3">
                  {invalidCount} invalid
                </span>
              )}
            </div>
          </div>
          <div className="rounded border overflow-x-auto max-h-[60vh]">
            <table className="w-full text-sm">
              <thead className="bg-neutral-100 text-left sticky top-0">
                <tr>
                  <th className="px-2 py-1 w-10">#</th>
                  {headers.map((h) => (
                    <th key={h} className="px-2 py-1">
                      {h}
                    </th>
                  ))}
                  <th className="px-2 py-1">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr
                    key={i}
                    className={`border-t ${r.valid ? "" : "bg-red-50"}`}
                  >
                    <td className="px-2 py-1 text-neutral-500">{i + 1}</td>
                    {renderCells(r.parsed).map((c, j) => (
                      <td key={j} className="px-2 py-1">
                        {c}
                      </td>
                    ))}
                    <td className="px-2 py-1 text-xs">
                      {r.valid ? (
                        <span className="text-emerald-700">ready</span>
                      ) : (
                        <span className="text-red-600">{r.error}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => {
                setRows(null);
                setFilename(null);
              }}
              className="rounded border px-3 py-2 text-sm hover:bg-neutral-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleImport}
              disabled={isPending || validCount === 0}
              className="rounded bg-solux px-3 py-2 text-white font-medium hover:bg-solux-dark disabled:opacity-50"
            >
              {isPending
                ? "Importing…"
                : `Import ${validCount} row${validCount !== 1 ? "s" : ""}`}
            </button>
          </div>
        </section>
      )}

      {result && <ResultBanner result={result} />}
    </div>
  );
}

// ===================================================================
//                    All (Excel) — single workbook
// ===================================================================

type AllPreview = {
  products: Preview<ProductImportRow>[] | null;
  prices: Preview<PriceImportRow>[] | null;
  options: Preview<OptionImportRow>[] | null;
  discoveredSheets: string[];
  skipped: string[];
  sheetErrors: Record<string, string>;
};

type AllResults = {
  products: ImportResult | null;
  prices: ImportResult | null;
  options: ImportResult | null;
};

function AllImportTab() {
  const router = useRouter();
  const [filename, setFilename] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<AllPreview | null>(null);
  const [results, setResults] = useState<AllResults | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleFile(file: File) {
    setError(null);
    setResults(null);
    setPreview(null);
    setFilename(file.name);

    if (!isXlsxFile(file)) {
      setError("This tab only accepts .xlsx workbooks.");
      return;
    }

    let allSheets: Record<string, string[][]>;
    try {
      allSheets = await readAllSheets(file);
    } catch (e: any) {
      console.error("[xlsx import] readAllSheets failed:", e);
      setError(`Could not read workbook: ${e?.message ?? "unknown error"}`);
      return;
    }

    const sheetList = Object.keys(allSheets);
    console.log(
      `[xlsx import] Found ${sheetList.length} sheet(s):`,
      sheetList
    );

    const lookup = {
      products: matchSheet(sheetList, "products"),
      prices: matchSheet(sheetList, "prices"),
      options: matchSheet(sheetList, "options"),
    };

    const skipped: string[] = [];
    const sheetErrors: Record<string, string> = {};

    // Products
    let products: Preview<ProductImportRow>[] | null = null;
    if (lookup.products) {
      console.log(`[xlsx import] Parsing "${lookup.products}" as products…`);
      const parsed = parseGrid<ProductImportRow>(
        allSheets[lookup.products],
        PRODUCT_ALIASES,
        ["sku"],
        parseProductRow
      );
      if (parsed.ok) {
        products = parsed.rows;
        console.log(`[xlsx import] products: ${parsed.rows.length} data rows`);
      } else {
        sheetErrors.products = parsed.error;
        console.warn(`[xlsx import] products sheet error: ${parsed.error}`);
      }
    } else {
      skipped.push("products");
      console.log("[xlsx import] products sheet: not found — skipping");
    }

    // Prices
    let prices: Preview<PriceImportRow>[] | null = null;
    if (lookup.prices) {
      console.log(`[xlsx import] Parsing "${lookup.prices}" as prices…`);
      const parsed = parseGrid<PriceImportRow>(
        allSheets[lookup.prices],
        PRICE_ALIASES,
        ["sku", "pricing_tier", "price"],
        parsePriceRow
      );
      if (parsed.ok) {
        prices = parsed.rows;
        console.log(`[xlsx import] prices: ${parsed.rows.length} data rows`);
      } else {
        sheetErrors.prices = parsed.error;
        console.warn(`[xlsx import] prices sheet error: ${parsed.error}`);
      }
    } else {
      skipped.push("prices");
      console.log("[xlsx import] prices sheet: not found — skipping");
    }

    // Options
    let options: Preview<OptionImportRow>[] | null = null;
    if (lookup.options) {
      console.log(`[xlsx import] Parsing "${lookup.options}" as options…`);
      const parsed = parseGrid<OptionImportRow>(
        allSheets[lookup.options],
        OPTION_ALIASES,
        ["sku", "option_type", "option_value"],
        parseOptionRow
      );
      if (parsed.ok) {
        options = parsed.rows;
        console.log(`[xlsx import] options: ${parsed.rows.length} data rows`);
      } else {
        sheetErrors.options = parsed.error;
        console.warn(`[xlsx import] options sheet error: ${parsed.error}`);
      }
    } else {
      skipped.push("options");
      console.log("[xlsx import] options sheet: not found — skipping");
    }

    if (!products && !prices && !options) {
      const hadErrors = Object.keys(sheetErrors).length > 0;
      setError(
        hadErrors
          ? `No importable sheets. ${Object.entries(sheetErrors)
              .map(([k, v]) => `${k}: ${v}`)
              .join(" · ")}`
          : `No importable sheets found. Workbook has: ${sheetList.join(", ") || "(none)"}`
      );
      return;
    }

    setPreview({
      products,
      prices,
      options,
      discoveredSheets: sheetList,
      skipped,
      sheetErrors,
    });
  }

  function handleRun() {
    if (!preview) return;
    setError(null);
    startTransition(async () => {
      const next: AllResults = { products: null, prices: null, options: null };
      try {
        if (preview.products) {
          const payload = preview.products.filter((r) => r.valid).map((r) => r.parsed);
          console.log(`[xlsx import] importing products: ${payload.length} rows`);
          next.products = await importProducts(payload);
          console.log("[xlsx import] products result:", next.products);
        }
        if (preview.prices) {
          const payload = preview.prices.filter((r) => r.valid).map((r) => r.parsed);
          console.log(`[xlsx import] importing prices: ${payload.length} rows`);
          next.prices = await importPrices(payload);
          console.log("[xlsx import] prices result:", next.prices);
        }
        if (preview.options) {
          const payload = preview.options.filter((r) => r.valid).map((r) => r.parsed);
          console.log(`[xlsx import] importing options: ${payload.length} rows`);
          next.options = await importOptions(payload);
          console.log("[xlsx import] options result:", next.options);
        }
        setResults(next);
        router.refresh();
      } catch (e: any) {
        console.error("[xlsx import] import failed:", e);
        setError(e?.message ?? "Import failed");
        setResults(next); // persist partial results
      }
    });
  }

  function countOf<T>(list: Preview<T>[] | null) {
    if (!list) return null;
    return {
      valid: list.filter((r) => r.valid).length,
      invalid: list.filter((r) => !r.valid).length,
    };
  }

  const counts = preview
    ? {
        products: countOf(preview.products),
        prices: countOf(preview.prices),
        options: countOf(preview.options),
      }
    : null;

  const totalValid =
    (counts?.products?.valid ?? 0) +
    (counts?.prices?.valid ?? 0) +
    (counts?.options?.valid ?? 0);

  return (
    <div className="space-y-4">
      <section className="rounded-lg border bg-white p-5 space-y-3">
        <h2 className="text-lg font-semibold">Single workbook (1–3 sheets)</h2>
        <p className="text-sm text-neutral-600">
          Upload one .xlsx file with any of these sheets: <code>products</code>,{" "}
          <code>prices</code>, <code>options</code>. Each sheet uses the same
          columns as the per-type CSV templates. Import runs in order: products
          first, then prices, then options.
        </p>
        <ul className="text-xs text-neutral-500 list-disc pl-5 space-y-0.5">
          <li>
            Sheet names matched by <b>name</b> (case-insensitive) — never by
            index. Extra sheets (e.g. <code>readme</code>) are ignored.
          </li>
          <li>
            Missing sheets are <b>skipped</b>, not an error. The import still
            runs for whichever sheets are present.
          </li>
          <li>
            Open the browser Console (⌥⌘I) for detailed per-step logs:
            discovered sheets, row counts, and import results.
          </li>
        </ul>
      </section>

      <section className="rounded-lg border bg-white p-5 space-y-3">
        <h2 className="text-lg font-semibold">Upload .xlsx</h2>
        <input
          type="file"
          accept={ACCEPT_XLSX_ONLY}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
          className="block w-full text-sm"
        />
        {filename && (
          <p className="text-xs text-neutral-500">
            Selected: <b>{filename}</b>
          </p>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </section>

      {preview && counts && (
        <section className="rounded-lg border bg-white p-5 space-y-3">
          <h2 className="text-lg font-semibold">Preview</h2>
          <p className="text-xs text-neutral-500">
            Sheets found in workbook:{" "}
            <span className="font-mono">
              {preview.discoveredSheets.join(", ")}
            </span>
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
            <SheetSummary
              label="Products"
              counts={counts.products}
              error={preview.sheetErrors.products}
              missing={preview.skipped.includes("products")}
            />
            <SheetSummary
              label="Prices"
              counts={counts.prices}
              error={preview.sheetErrors.prices}
              missing={preview.skipped.includes("prices")}
            />
            <SheetSummary
              label="Options"
              counts={counts.options}
              error={preview.sheetErrors.options}
              missing={preview.skipped.includes("options")}
            />
          </div>
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => {
                setPreview(null);
                setFilename(null);
              }}
              className="rounded border px-3 py-2 text-sm hover:bg-neutral-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleRun}
              disabled={isPending || totalValid === 0}
              className="rounded bg-solux px-3 py-2 text-white font-medium hover:bg-solux-dark disabled:opacity-50"
            >
              {isPending ? "Importing…" : `Import (${totalValid} rows)`}
            </button>
          </div>
        </section>
      )}

      {results && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Results</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {results.products && (
              <ResultBanner label="Products" result={results.products} />
            )}
            {results.prices && (
              <ResultBanner label="Prices" result={results.prices} />
            )}
            {results.options && (
              <ResultBanner label="Options" result={results.options} />
            )}
          </div>
          <a href="/admin/products" className="text-sm text-solux-dark hover:underline">
            Go to products →
          </a>
        </section>
      )}
    </div>
  );
}

function SheetSummary({
  label,
  counts,
  error,
  missing,
}: {
  label: string;
  counts: { valid: number; invalid: number } | null;
  error?: string;
  missing?: boolean;
}) {
  const baseClass = "rounded border p-3";
  if (missing) {
    return (
      <div className={`${baseClass} bg-neutral-50`}>
        <div className="font-medium text-neutral-500">{label}</div>
        <div className="text-xs mt-1 text-neutral-500">
          Sheet not found — skipped
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className={`${baseClass} bg-red-50 border-red-200`}>
        <div className="font-medium">{label}</div>
        <div className="text-xs mt-1 text-red-700">{error}</div>
      </div>
    );
  }
  if (!counts) return null;
  return (
    <div className={baseClass}>
      <div className="font-medium">{label}</div>
      <div className="text-xs mt-1">
        <span className="text-emerald-700">{counts.valid} ready</span>
        {counts.invalid > 0 && (
          <span className="text-red-600 ml-2">{counts.invalid} invalid</span>
        )}
      </div>
    </div>
  );
}

function ResultBanner({
  result,
  label,
}: {
  result: ImportResult;
  label?: string;
}) {
  return (
    <div className="rounded-lg border bg-emerald-50 border-emerald-200 p-3 text-sm space-y-1">
      {label && <div className="font-semibold">{label}</div>}
      <div className="text-emerald-800">
        {result.created} created · {result.updated} updated
        {result.skipped > 0 && ` · ${result.skipped} skipped`}
      </div>
      {result.unmatched_skus && result.unmatched_skus.length > 0 && (
        <div className="text-amber-800 text-xs">
          <b>Unmatched SKUs:</b> {result.unmatched_skus.join(", ")}
        </div>
      )}
      {result.errors.length > 0 && (
        <details className="text-red-700 text-xs">
          <summary className="cursor-pointer">
            {result.errors.length} error{result.errors.length > 1 ? "s" : ""}
          </summary>
          <ul className="list-disc pl-5 mt-1 space-y-0.5">
            {result.errors.slice(0, 10).map((e, i) => (
              <li key={i}>{e}</li>
            ))}
            {result.errors.length > 10 && (
              <li>…and {result.errors.length - 10} more</li>
            )}
          </ul>
        </details>
      )}
    </div>
  );
}

// ===================================================================
//                           Page wrapper
// ===================================================================

export default function ImportClient() {
  const [tab, setTab] = useState<Tab>("products");

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded border overflow-hidden text-sm">
        {(["products", "prices", "options", "all"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-4 py-2 capitalize ${
              tab === t ? "bg-black text-white" : "bg-white"
            }`}
          >
            {t === "all" ? "All (Excel)" : t}
          </button>
        ))}
      </div>

      {tab === "products" && (
        <ImportTab<ProductImportRow>
          description={
            <>
              <p className="text-sm text-neutral-600">
                Upserts by SKU: if a product with this SKU exists, it&apos;s
                updated. Otherwise it&apos;s created.
              </p>
              <div className="rounded border bg-neutral-50 p-3 text-xs font-mono overflow-x-auto">
                sku, name, category, image_url, cost, active
              </div>
              <p className="text-xs text-neutral-500">
                Only <b>sku</b> is always required. <b>name</b> is required for
                new products. Empty cells are ignored when updating — you can
                import rows with only <code>sku,cost</code> to update costs.
                <b> active</b> accepts TRUE/FALSE, YES/NO, 1/0 (defaults to
                TRUE for new products).
              </p>
            </>
          }
          templateName="solux_products_template.csv"
          templateCsv={TEMPLATES.products}
          aliases={PRODUCT_ALIASES}
          requiredKeys={["sku"]}
          sheetName="products"
          parseRow={parseProductRow}
          runImport={importProducts}
          headers={["SKU", "Name", "Category", "Image", "Cost", "Active"]}
          renderCells={(r) => [
            <span key="k" className="font-mono text-xs">
              {r.sku || "—"}
            </span>,
            r.name || <span className="text-neutral-400 text-xs">(no change)</span>,
            r.category || "—",
            r.image_url ? (
              <span className="text-xs text-neutral-500 truncate max-w-[160px] inline-block align-middle">
                {r.image_url}
              </span>
            ) : (
              "—"
            ),
            r.cost_price != null ? r.cost_price.toFixed(2) : "—",
            r.active === undefined ? "—" : r.active ? "yes" : "no",
          ]}
        />
      )}

      {tab === "prices" && (
        <ImportTab<PriceImportRow>
          description={
            <>
              <p className="text-sm text-neutral-600">
                Upserts by (SKU + pricing_tier + valid_from). Rows with unknown
                SKUs are skipped and listed in the result.
              </p>
              <div className="rounded border bg-neutral-50 p-3 text-xs font-mono overflow-x-auto">
                sku, pricing_tier, price, valid_from
              </div>
              <p className="text-xs text-neutral-500">
                <b>pricing_tier</b> must be <code>high</code>, <code>medium</code>
                , or <code>low</code>. <b>valid_from</b> is optional (defaults
                to today) in <code>YYYY-MM-DD</code> format.
              </p>
            </>
          }
          templateName="solux_prices_template.csv"
          templateCsv={TEMPLATES.prices}
          aliases={PRICE_ALIASES}
          requiredKeys={["sku", "pricing_tier", "price"]}
          sheetName="prices"
          parseRow={parsePriceRow}
          runImport={importPrices}
          headers={["SKU", "Tier", "Price", "Valid from"]}
          renderCells={(r) => [
            <span key="k" className="font-mono text-xs">
              {r.sku || "—"}
            </span>,
            <span key="t" className="capitalize">
              {r.pricing_tier ?? "—"}
            </span>,
            r.price != null ? r.price.toFixed(2) : "—",
            r.valid_from || "today",
          ]}
        />
      )}

      {tab === "options" && (
        <ImportTab<OptionImportRow>
          description={
            <>
              <p className="text-sm text-neutral-600">
                Upserts by (SKU + option_type + option_value). Matching is
                case-insensitive on option fields.
              </p>
              <div className="rounded border bg-neutral-50 p-3 text-xs font-mono overflow-x-auto">
                sku, option_type, option_value, price_modifier
              </div>
              <p className="text-xs text-neutral-500">
                <b>price_modifier</b> defaults to 0 if blank.
              </p>
            </>
          }
          templateName="solux_options_template.csv"
          templateCsv={TEMPLATES.options}
          aliases={OPTION_ALIASES}
          requiredKeys={["sku", "option_type", "option_value"]}
          sheetName="options"
          parseRow={parseOptionRow}
          runImport={importOptions}
          headers={["SKU", "Type", "Value", "Modifier"]}
          renderCells={(r) => [
            <span key="k" className="font-mono text-xs">
              {r.sku || "—"}
            </span>,
            r.option_type || "—",
            r.option_value || "—",
            r.price_modifier != null ? r.price_modifier.toFixed(2) : "0.00",
          ]}
        />
      )}

      {tab === "all" && <AllImportTab />}
    </div>
  );
}
