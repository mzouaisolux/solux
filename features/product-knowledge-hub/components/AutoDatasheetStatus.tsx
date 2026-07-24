"use client";

/**
 * Live generation status for a model's AUTO datasheet — the "publish first,
 * render out of band" half of the documents layer.
 *
 * Publish (approveRequest) stages the auto sheet as 'pending' and returns
 * immediately; it never blocks on PDF generation. This component surfaces that
 * state and materialises the sheet without a manual click:
 *
 *   pending → auto-triggers renderSpecSheet ONCE on view, shows "Generating…",
 *             then refreshes the route so the row flips to 'ready'.
 *   failed  → shows the failure with a manual Retry (no auto-retry loop).
 *   ready / stale / figma_override → nothing (the Download/Preview buttons own it).
 *
 * The render action is idempotent (upsert on product+version+kind), so two
 * concurrent viewers can't corrupt anything — the later write just wins.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { renderSpecSheet } from "../render/renderSpecSheet";

type Props = {
  productId: string;
  version: string | null;
  /** Current auto-sheet status (from the spec_documents row), or null if none. */
  status: string | null;
};

export function AutoDatasheetStatus({ productId, version, status }: Props) {
  const router = useRouter();
  const [phase, setPhase] = useState<"idle" | "rendering" | "failed">("idle");
  // Ensures we attempt the auto-render at most once per mount (no refire loop).
  const attempted = useRef(false);

  async function generate() {
    if (!version) return;
    setPhase("rendering");
    try {
      await renderSpecSheet(productId, version);
      router.refresh(); // re-reads the server component → status becomes 'ready'
    } catch {
      setPhase("failed");
    }
  }

  useEffect(() => {
    if (status === "pending" && !attempted.current) {
      attempted.current = true;
      void generate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  if (!version) return null;

  const showFailed = phase === "failed" || status === "failed";

  if (phase === "rendering" || status === "pending") {
    return (
      <p className="sx-micro" style={{ marginTop: 12, color: "#8a5a12" }}>
        Generating datasheet from {version}…
      </p>
    );
  }

  if (showFailed) {
    return (
      <p className="sx-micro" style={{ marginTop: 12, color: "#b91c1c" }}>
        Auto-generation didn’t finish.{" "}
        <button
          type="button"
          onClick={() => {
            attempted.current = true;
            void generate();
          }}
          style={{
            background: "none",
            border: "none",
            padding: 0,
            color: "#b91c1c",
            textDecoration: "underline",
            cursor: "pointer",
            font: "inherit",
          }}
        >
          Retry
        </button>
      </p>
    );
  }

  return null;
}

export default AutoDatasheetStatus;
