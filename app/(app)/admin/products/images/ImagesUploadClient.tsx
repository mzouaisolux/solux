"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient as createBrowserSupabase } from "@/lib/supabase/client";
import {
  fileExtension,
  normalizeSku,
  stripExtension,
} from "@/lib/normalize";

type ProductLite = {
  id: string;
  name: string;
  sku: string | null;
  image_url: string | null;
};

type Status = "ready" | "unmatched" | "uploading" | "done" | "error" | "skipped";

type Row = {
  file: File;
  baseName: string;
  match: ProductLite | null;
  overwrite: boolean; // only consulted when match has image_url
  status: Status;
  message?: string;
};

const ACCEPT = "image/*";
const IMAGE_EXT = ["png", "jpg", "jpeg", "webp", "gif"];
const MAX_FILES = 100;
const LARGE_FILE_MB = 10;

export default function ImagesUploadClient({
  products,
}: {
  products: ProductLite[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [dragging, setDragging] = useState(false);

  const bySku = useMemo(() => {
    const map = new Map<string, ProductLite>();
    for (const p of products) {
      if (p.sku) map.set(normalizeSku(p.sku), p);
    }
    return map;
  }, [products]);

  function matchFile(file: File): Pick<Row, "baseName" | "match"> {
    const baseName = stripExtension(file.name);
    const match = bySku.get(normalizeSku(baseName)) ?? null;
    return { baseName, match };
  }

  function handleFiles(files: FileList | File[] | null) {
    setError(null);
    if (!files) return;
    const all = Array.from(files).filter(
      (f) => f.type.startsWith("image/") || IMAGE_EXT.includes(fileExtension(f.name))
    );
    if (all.length === 0) {
      setError("No image files detected.");
      return;
    }
    const list = all.slice(0, MAX_FILES);
    const next: Row[] = list.map((f) => {
      const { baseName, match } = matchFile(f);
      return {
        file: f,
        baseName,
        match,
        overwrite: false,
        status: match ? "ready" : "unmatched",
      };
    });
    setRows(next);

    const warnings: string[] = [];
    if (all.length > MAX_FILES) {
      warnings.push(
        `Selected ${all.length} files — only the first ${MAX_FILES} were loaded to protect the browser.`
      );
    }
    const big = list.filter((f) => f.size > LARGE_FILE_MB * 1024 * 1024);
    if (big.length > 0) {
      warnings.push(
        `${big.length} file${big.length > 1 ? "s" : ""} over ${LARGE_FILE_MB}MB — uploads will be slower.`
      );
    }
    if (warnings.length) setError(warnings.join(" "));
  }

  function onDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (!dragging) setDragging(true);
  }
  function onDragLeave(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
  }
  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  }

  async function uploadOne(row: Row, index: number): Promise<Row> {
    if (!row.match) return { ...row, status: "unmatched" };
    if (row.match.image_url && !row.overwrite) {
      return {
        ...row,
        status: "skipped",
        message: "Existing image — tick overwrite to replace",
      };
    }

    const supabase = createBrowserSupabase();
    const ext = fileExtension(row.file.name) || "jpg";
    const path = `${row.match.id}.${ext}`;

    const { error: upErr } = await supabase.storage
      .from("product-images")
      .upload(path, row.file, {
        contentType: row.file.type || "image/jpeg",
        upsert: true,
      });
    if (upErr) return { ...row, status: "error", message: upErr.message };

    const { data } = supabase.storage
      .from("product-images")
      .getPublicUrl(path);
    const publicUrl = data.publicUrl;

    // Cache-bust so <img> refreshes when re-uploading the same SKU.
    const busted = `${publicUrl}?v=${Date.now()}`;
    const { error: updErr } = await supabase
      .from("products")
      .update({ image_url: busted })
      .eq("id", row.match.id);
    if (updErr) return { ...row, status: "error", message: updErr.message };

    return { ...row, status: "done", message: "uploaded" };
  }

  function handleUpload() {
    if (!rows.length) return;
    setError(null);

    startTransition(async () => {
      // Mark everything actionable as uploading.
      setRows((prev) =>
        prev.map((r) =>
          r.match && (!r.match.image_url || r.overwrite)
            ? { ...r, status: "uploading" as Status }
            : r
        )
      );

      // Snapshot current rows to iterate without racing React state.
      const snapshot = [...rows];
      for (let i = 0; i < snapshot.length; i++) {
        const result = await uploadOne(snapshot[i], i);
        // Update only the changed row; drop the File reference to free memory.
        setRows((prev) =>
          prev.map((r, idx) =>
            idx === i ? { ...result, file: result.file } : r
          )
        );
      }
      router.refresh();
    });
  }

  const readyCount = rows.filter(
    (r) => r.status === "ready" && (!r.match?.image_url || r.overwrite)
  ).length;
  const unmatchedCount = rows.filter((r) => r.status === "unmatched").length;
  const doneCount = rows.filter((r) => r.status === "done").length;

  return (
    <div className="space-y-4">
      <section className="rounded-lg border bg-white p-5 space-y-3">
        <h2 className="text-lg font-semibold">How matching works</h2>
        <ul className="text-sm text-neutral-600 list-disc pl-5 space-y-1">
          <li>
            The filename (without extension) is matched against product{" "}
            <b>SKU</b> — case-insensitive, whitespace-insensitive.
          </li>
          <li>
            Example: <code>STR-60.jpg</code> matches the product with SKU{" "}
            <code>STR-60</code>.
          </li>
          <li>
            Existing images are <b>not</b> overwritten unless you tick{" "}
            <b>overwrite</b>.
          </li>
          <li>
            Products without a SKU won&apos;t match anything — set a SKU first.
          </li>
        </ul>
      </section>

      <section className="rounded-lg border bg-white p-5 space-y-3">
        <h2 className="text-lg font-semibold">Select images</h2>

        <div
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          className={`rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
            dragging
              ? "border-solux bg-amber-50"
              : "border-neutral-300 bg-neutral-50"
          }`}
        >
          <p className="text-sm font-medium">
            Drag &amp; drop image files here
          </p>
          <p className="text-xs text-neutral-500 mt-1">
            Works best for many files — bypasses the macOS picker.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-neutral-500">or</span>
          <label className="inline-block rounded border px-3 py-2 text-sm hover:bg-neutral-50 cursor-pointer">
            Choose files…
            <input
              type="file"
              accept={ACCEPT}
              multiple
              onChange={(e) => handleFiles(e.target.files)}
              className="hidden"
            />
          </label>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
      </section>

      {rows.length > 0 && (
        <section className="rounded-lg border bg-white p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Preview</h2>
            <div className="text-sm">
              <span className="text-emerald-700 font-medium">
                {readyCount} ready
              </span>
              {unmatchedCount > 0 && (
                <span className="text-red-600 ml-3">
                  {unmatchedCount} unmatched
                </span>
              )}
              {doneCount > 0 && (
                <span className="text-neutral-600 ml-3">{doneCount} done</span>
              )}
            </div>
          </div>

          <div className="rounded border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-neutral-100 text-left">
                <tr>
                  <th className="px-2 py-1">File</th>
                  <th className="px-2 py-1">Matched product</th>
                  <th className="px-2 py-1">Existing image</th>
                  <th className="px-2 py-1">Overwrite</th>
                  <th className="px-2 py-1">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr
                    key={i}
                    className={`border-t ${
                      r.status === "unmatched"
                        ? "bg-red-50"
                        : r.status === "error"
                        ? "bg-red-50"
                        : r.status === "done"
                        ? "bg-emerald-50"
                        : ""
                    }`}
                  >
                    <td className="px-2 py-1">
                      <div className="font-mono text-xs">{r.file.name}</div>
                      <div className="text-[11px] text-neutral-500">
                        {(r.file.size / 1024).toFixed(0)} KB
                      </div>
                    </td>
                    <td className="px-2 py-1">
                      {r.match ? (
                        <>
                          <div className="font-medium">{r.match.name}</div>
                          <div className="text-xs text-neutral-500 font-mono">
                            {r.match.sku}
                          </div>
                        </>
                      ) : (
                        <span className="text-red-600 text-xs">
                          No product with SKU “{r.baseName}”
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1">
                      {r.match?.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={r.match.image_url}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          className="h-10 w-10 object-cover rounded border"
                        />
                      ) : (
                        <span className="text-xs text-neutral-500">—</span>
                      )}
                    </td>
                    <td className="px-2 py-1">
                      {r.match?.image_url ? (
                        <input
                          type="checkbox"
                          checked={r.overwrite}
                          disabled={
                            r.status === "uploading" || r.status === "done"
                          }
                          onChange={(e) =>
                            setRows((prev) =>
                              prev.map((x, idx) =>
                                idx === i
                                  ? { ...x, overwrite: e.target.checked }
                                  : x
                              )
                            )
                          }
                        />
                      ) : (
                        <span className="text-xs text-neutral-400">—</span>
                      )}
                    </td>
                    <td className="px-2 py-1 text-xs">
                      {r.status === "ready" && (
                        <span className="text-emerald-700">ready</span>
                      )}
                      {r.status === "unmatched" && (
                        <span className="text-red-600">unmatched</span>
                      )}
                      {r.status === "uploading" && (
                        <span className="text-neutral-600">uploading…</span>
                      )}
                      {r.status === "done" && (
                        <span className="text-emerald-700">
                          done {r.message && `· ${r.message}`}
                        </span>
                      )}
                      {r.status === "skipped" && (
                        <span className="text-neutral-600">
                          skipped {r.message && `· ${r.message}`}
                        </span>
                      )}
                      {r.status === "error" && (
                        <span className="text-red-600">
                          error {r.message && `· ${r.message}`}
                        </span>
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
              onClick={() => setRows([])}
              disabled={isPending}
              className="rounded border px-3 py-2 text-sm hover:bg-neutral-50 disabled:opacity-50"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={handleUpload}
              disabled={isPending || readyCount === 0}
              className="rounded bg-solux px-3 py-2 text-white font-medium hover:bg-solux-dark disabled:opacity-50"
            >
              {isPending
                ? "Uploading…"
                : `Upload ${readyCount} image${readyCount !== 1 ? "s" : ""}`}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
