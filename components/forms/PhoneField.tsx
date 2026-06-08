"use client";

import { useState } from "react";
import { DIAL_OPTIONS } from "@/lib/countries";

/**
 * PhoneField — dialing-code dropdown + local number input.
 *
 * Emits two form fields:
 *   - phoneCodeName  → the dial prefix ("+229")  → clients.phone_country_code
 *   - phoneNumberName → the local number          → clients.phone_number
 *
 * The dropdown lists every country with its code, sorted by name, so
 * the prefix is standardized instead of being typed inline. Several
 * countries share a dial (NANP "+1"); the stored value is just the
 * dial string, which is all we need.
 *
 * Controlled-optional via onChange for forms that keep their own state.
 */
export function PhoneField({
  phoneCodeName,
  phoneNumberName,
  defaultCode,
  defaultNumber,
  onChange,
  className = "",
}: {
  phoneCodeName: string;
  phoneNumberName: string;
  defaultCode?: string | null;
  defaultNumber?: string | null;
  onChange?: (next: { code: string; number: string }) => void;
  className?: string;
}) {
  const [code, setCode] = useState(defaultCode ?? "");
  const [number, setNumber] = useState(defaultNumber ?? "");

  const update = (next: { code?: string; number?: string }) => {
    const c = next.code ?? code;
    const n = next.number ?? number;
    if (next.code !== undefined) setCode(next.code);
    if (next.number !== undefined) setNumber(next.number);
    onChange?.({ code: c, number: n });
  };

  return (
    <div className={`flex gap-2 ${className}`}>
      <input type="hidden" name={phoneCodeName} value={code} />
      <select
        aria-label="Country dialing code"
        value={code}
        onChange={(e) => update({ code: e.target.value })}
        className="w-32 shrink-0 rounded border border-neutral-200 px-2 py-2 text-sm bg-white focus:border-neutral-400 focus:outline-none focus:ring-1 focus:ring-neutral-400"
      >
        <option value="">Code</option>
        {DIAL_OPTIONS.map((d) => (
          <option key={d.code} value={d.dial}>
            {d.name} ({d.dial})
          </option>
        ))}
      </select>
      <input
        type="tel"
        name={phoneNumberName}
        value={number}
        placeholder="Phone number"
        onChange={(e) => update({ number: e.target.value })}
        // min-w-0 lets the input shrink below its intrinsic size so the
        // code + number pair never overflows a narrow grid cell.
        className="min-w-0 flex-1 rounded border border-neutral-200 px-3 py-2 text-sm focus:border-neutral-400 focus:outline-none focus:ring-1 focus:ring-neutral-400"
      />
    </div>
  );
}
