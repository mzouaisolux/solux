"use client";

import { useState } from "react";

/** Small copy-to-clipboard button used by the Integration Guide code blocks. */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard blocked — no-op */
        }
      }}
      className="inline-flex items-center rounded-md border border-neutral-200 px-2 py-1 text-xs font-medium hover:border-neutral-900"
    >
      {done ? "Copied" : label}
    </button>
  );
}

export default CopyButton;
