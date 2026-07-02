/**
 * Sales & Analytics — pure CSV parsing for the migration import (§7).
 *
 * Dependency-free RFC-4180 parser (quotes, embedded commas/newlines, "" escape)
 * + typed row mappers for the three source files. Numbers follow the spec's
 * cardinal rule: an EMPTY cell is `null` (missing), NEVER 0. Takes text in,
 * does no I/O — the script/test reads the file and passes the string.
 */

/** Parse RFC-4180 CSV text into a matrix of string cells. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  // Normalize CRLF/CR → LF so newline handling is uniform.
  const s = text.replace(/\r\n?/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } // escaped quote
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\n") {
      row.push(field); field = "";
      rows.push(row); row = [];
    } else {
      field += c;
    }
  }
  // Flush the last field/row unless the file ended on a clean newline.
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  // Drop fully-empty rows (trailing blank lines).
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/** "" → null; otherwise a finite number, else null (never a silent 0). */
export function num(v: string | null | undefined): number | null {
  const t = (v ?? "").trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** "" → null; otherwise an integer, else null. */
export function intg(v: string | null | undefined): number | null {
  const n = num(v);
  return n === null ? null : Math.trunc(n);
}

/** "" → null; otherwise the trimmed string. */
export function str(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
}

/** Header-driven mapping: returns objects keyed by the first row's column names. */
function toRecords(matrix: string[][]): Record<string, string>[] {
  if (matrix.length === 0) return [];
  const header = matrix[0].map((h) => h.trim());
  return matrix.slice(1).map((cells) => {
    const rec: Record<string, string> = {};
    header.forEach((h, i) => { rec[h] = cells[i] ?? ""; });
    return rec;
  });
}

// ── orders.csv ──────────────────────────────────────────────────────────────
export type OrderRow = {
  client_id: string;
  client_name: string;
  year: number | null;
  month: number | null;
  order_date: string | null;
  country: string | null;
  saler: string | null;
  pi_no: string | null;
  payment_terms: string | null;
  pi_amount: number | null;
  sales_amount: number | null;
  transportation: number | null;
  received_amount: number | null;
  bank_charge: number | null;
  balance: number | null;
  shipment_date: string | null;
  eta_note: string | null;
  pickup: string | null;
  client_raw: string | null;
  country_raw: string | null;
  saler_raw: string | null;
};

export function parseOrdersCsv(text: string): OrderRow[] {
  return toRecords(parseCsv(text)).map((r) => ({
    client_id: (r.client_id ?? "").trim(),
    client_name: (r.client_name ?? "").trim(),
    year: intg(r.year),
    month: intg(r.month),
    order_date: str(r.order_date),
    country: str(r.country),
    saler: str(r.saler),
    pi_no: str(r.pi_no),
    payment_terms: str(r.payment_terms),
    pi_amount: num(r.pi_amount),
    sales_amount: num(r.sales_amount),
    transportation: num(r.transportation),
    received_amount: num(r.received_amount),
    bank_charge: num(r.bank_charge),
    balance: num(r.balance),
    shipment_date: str(r.shipment_date),
    eta_note: str(r.eta_note),
    pickup: str(r.pickup),
    client_raw: str(r.client_raw),
    country_raw: str(r.country_raw),
    saler_raw: str(r.saler_raw),
  }));
}

// ── clients.csv ─────────────────────────────────────────────────────────────
export type ClientRow = {
  client_id: string;
  client_name: string;
  orders: number | null;
  total_sales: number | null;
  first_year: number | null;
  last_year: number | null;
  main_country: string | null;
  spelling_variants: string[];
};

export function parseClientsCsv(text: string): ClientRow[] {
  return toRecords(parseCsv(text)).map((r) => ({
    client_id: (r.client_id ?? "").trim(),
    client_name: (r.client_name ?? "").trim(),
    orders: intg(r.orders),
    total_sales: num(r.total_sales),
    first_year: intg(r.first_year),
    last_year: intg(r.last_year),
    main_country: str(r.main_country),
    spelling_variants: (r.spelling_variants ?? "")
      .split("|")
      .map((v) => v.trim())
      .filter((v) => v.length > 0),
  }));
}

// ── monthly_sales.csv ───────────────────────────────────────────────────────
export type MonthlyRow = {
  year: number;
  month: number;
  label: string | null;
  saler: string;
  sales: number;
  is_reconstructed: boolean;
};

export function parseMonthlySalesCsv(text: string): MonthlyRow[] {
  return toRecords(parseCsv(text)).map((r) => {
    const label = str(r.label);
    const month = intg(r.month) ?? 0;
    return {
      year: intg(r.year) ?? 0,
      month,
      label,
      saler: (r.saler ?? "").trim().toUpperCase(),
      sales: num(r.sales) ?? 0,
      is_reconstructed: month === 0 || /reconstitu/i.test(label ?? ""),
    };
  });
}

// ── merge_suggestions.csv (optional 4th file) ───────────────────────────────
export type MergeSuggestionRow = {
  score: number | null;
  client_a: string;
  orders_a: number | null;
  client_b: string;
  orders_b: number | null;
  decision: string | null;
};

export function parseMergeSuggestionsCsv(text: string): MergeSuggestionRow[] {
  return toRecords(parseCsv(text)).map((r) => ({
    score: num(r.score),
    client_a: (r.client_a ?? "").trim(),
    orders_a: intg(r.orders_a),
    client_b: (r.client_b ?? "").trim(),
    orders_b: intg(r.orders_b),
    decision: str(r.decision),
  }));
}
