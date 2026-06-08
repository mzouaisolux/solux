"use client";

import readXlsxFile, { readSheet as readSheetRaw } from "read-excel-file/browser";

// Returns the same string[][] shape as parseCSV — cells coerced to strings.
export async function readSheet(
  file: File,
  sheetName: string
): Promise<string[][]> {
  const data = await readSheetRaw(file, sheetName);
  return data.map((row) =>
    row.map((cell) => {
      if (cell == null) return "";
      if (cell instanceof Date) return cell.toISOString().slice(0, 10);
      return String(cell);
    })
  );
}

export async function listSheetNames(file: File): Promise<string[]> {
  const sheets = await readXlsxFile(file);
  return sheets.map((s) => s.sheet);
}

// Read the whole workbook as { sheetName: grid } — efficient when you need multiple sheets.
export async function readAllSheets(
  file: File
): Promise<Record<string, string[][]>> {
  const sheets = await readXlsxFile(file);
  const map: Record<string, string[][]> = {};
  for (const s of sheets) {
    map[s.sheet] = s.data.map((row) =>
      row.map((cell) => {
        if (cell == null) return "";
        if (cell instanceof Date) return cell.toISOString().slice(0, 10);
        return String(cell);
      })
    );
  }
  return map;
}

// Normalize for case-insensitive sheet lookup.
export function matchSheet(available: string[], wanted: string): string | null {
  const w = wanted.trim().toLowerCase();
  return available.find((s) => s.trim().toLowerCase() === w) ?? null;
}
