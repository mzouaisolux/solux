// Canonical form used to match SKUs and filenames.
// Case-insensitive, whitespace-insensitive.
export function normalizeSku(input: string | null | undefined): string {
  return (input ?? "").toLowerCase().replace(/\s+/g, "").trim();
}

export function stripExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(0, dot) : filename;
}

export function fileExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(dot + 1).toLowerCase() : "";
}
