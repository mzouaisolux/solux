"use client";

/**
 * Download / open the current auto spec sheet for a model.
 *
 * If the current-version auto sheet is already 'ready', opens the stored file
 * (fresh signed URL). Otherwise it renders it on demand (server, Node runtime)
 * then opens the result. Figma overrides are treated as ready stored files.
 */

import { useState, useTransition } from "react";
import { renderSpecSheet, getSpecSheetSignedUrl } from "../render/renderSpecSheet";

type Props = {
  productId: string;
  version: string | null;
  /** The current spec_document, if any. */
  doc: { status: string; storage_path: string | null } | null;
  /** Button label variant. "preview" opens the sheet (browsers show PDF inline);
   *  "download" is the primary generate/download action. */
  variant?: "download" | "preview";
  /** Full-width button (stacked in the datasheet card). */
  block?: boolean;
};

export function DownloadSpecSheetButton({ productId, version, doc, variant = "download", block = false }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!version) {
    return <span className="sx-micro">No published version yet</span>;
  }

  const ready = doc?.status === "ready" && !!doc.storage_path;

  function open(url: string | null) {
    if (url) window.open(url, "_blank", "noopener,noreferrer");
    else setError("Could not obtain a link for the spec sheet.");
  }

  function handleClick() {
    setError(null);
    startTransition(async () => {
      try {
        if (ready && doc?.storage_path) {
          open(await getSpecSheetSignedUrl(doc.storage_path));
        } else {
          const { signedUrl } = await renderSpecSheet(productId, version!);
          open(signedUrl);
        }
      } catch (e: any) {
        setError(e?.message ?? "Failed to produce the spec sheet.");
      }
    });
  }

  const label = pending
    ? "Preparing…"
    : variant === "preview"
      ? "Preview datasheet"
      : ready
        ? "Download PDF"
        : "Generate & download PDF";
  const cls = variant === "preview" ? "sx-btn" : "sx-btn sx-btn-go";

  return (
    <span style={{ display: block ? "block" : "inline-flex", flexDirection: "column", gap: 4 }}>
      <button
        type="button"
        className={cls}
        onClick={handleClick}
        disabled={pending}
        style={block ? { width: "100%", justifyContent: "center" } : undefined}
      >
        {label}
      </button>
      {error ? <span className="sx-micro" style={{ color: "#b91c1c" }}>{error}</span> : null}
    </span>
  );
}

export default DownloadSpecSheetButton;
