"use client";

import { useState } from "react";
import type { ClientCustomField } from "@/lib/types";

export default function CustomFieldsEditor({
  initial,
}: {
  initial: ClientCustomField[];
}) {
  const [rows, setRows] = useState<ClientCustomField[]>(
    initial.length ? initial : []
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-sm font-medium">Tax / registration fields</span>
          <p className="text-xs text-neutral-500">
            Optional. Country-specific identifiers — VAT, SIRET, SRU, etc.
            Only filled fields appear on the PDF.
          </p>
        </div>
        <button
          type="button"
          onClick={() =>
            setRows((r) => [...r, { label: "", value: "" }])
          }
          className="text-sm text-solux-dark hover:underline"
        >
          + Add field
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-neutral-500 italic">
          No custom fields. Click <b>+ Add field</b> to start.
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div
              key={i}
              className="grid grid-cols-[1fr_2fr_auto] gap-2 items-center"
            >
              <input
                name="custom_field_label"
                value={r.label}
                placeholder="Label (e.g. VAT Number)"
                onChange={(e) =>
                  setRows((prev) =>
                    prev.map((x, idx) =>
                      idx === i ? { ...x, label: e.target.value } : x
                    )
                  )
                }
                className="rounded border border-neutral-200 px-3 py-2 text-sm"
              />
              <input
                name="custom_field_value"
                value={r.value}
                placeholder="Value (e.g. FR123456)"
                onChange={(e) =>
                  setRows((prev) =>
                    prev.map((x, idx) =>
                      idx === i ? { ...x, value: e.target.value } : x
                    )
                  )
                }
                className="rounded border border-neutral-200 px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={() =>
                  setRows((prev) => prev.filter((_, idx) => idx !== i))
                }
                className="rounded border border-neutral-200 px-2 py-1.5 text-xs text-red-600 hover:bg-red-50"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
