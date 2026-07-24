"use client";

// Integrations Phase 2 — API keys (admin). Create returns the plaintext once;
// after that only the prefix + hash remain. Revocation is immediate.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/feedback/toast-store";
import { createApiKey, revokeApiKey, type ApiKeyRow } from "@/features/Intergration/actions/api-keys";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmt = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

const btn =
  "inline-flex items-center rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm font-medium hover:border-neutral-900 disabled:opacity-40";

export function ApiKeysManager({ initial }: { initial: ApiKeyRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [label, setLabel] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);

  function create() {
    startTransition(async () => {
      try {
        const res = await createApiKey(label);
        setFresh(res.plaintext);
        setLabel("");
        toast.success("API key created");
        router.refresh();
      } catch (e: any) {
        toast.error(e?.message ?? "Could not create key");
      }
    });
  }

  function revoke(id: string) {
    startTransition(async () => {
      try {
        await revokeApiKey(id);
        toast.success("Key revoked");
        router.refresh();
      } catch (e: any) {
        toast.error(e?.message ?? "Could not revoke key");
      }
    });
  }

  return (
    <div className="space-y-3">
      {fresh ? (
        <div className="rounded-md border-l-2 border-green-600 bg-green-50 px-3 py-2.5">
          <div className="text-sm font-semibold text-green-800">Copy it now — shown once, then only the hash is stored.</div>
          <code className="mt-1 block break-all rounded bg-white px-2 py-1 text-xs">{fresh}</code>
          <button type="button" className={`${btn} mt-2`} onClick={() => setFresh(null)}>
            I copied it
          </button>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-md border border-neutral-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
              <th className="px-3 py-2">Key</th>
              <th className="px-3 py-2">Label</th>
              <th className="px-3 py-2">Created</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {initial.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-sm text-neutral-500">
                  No API keys yet.
                </td>
              </tr>
            ) : (
              initial.map((k) => (
                <tr key={k.id} className="border-t border-neutral-100">
                  <td className="px-3 py-2 font-mono text-xs">{k.prefix}</td>
                  <td className="px-3 py-2">{k.label}</td>
                  <td className="px-3 py-2 text-neutral-500">{fmt(k.created_at)}</td>
                  <td className="px-3 py-2">
                    {k.revoked_at ? (
                      <span className="rounded-full border border-neutral-200 px-2 py-0.5 text-[10px] font-semibold uppercase text-neutral-500">
                        revoked
                      </span>
                    ) : (
                      <span className="rounded-full border border-green-300 bg-green-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-green-800">
                        active
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {!k.revoked_at ? (
                      <button type="button" className={btn} disabled={pending} onClick={() => revoke(k.id)}>
                        Revoke
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          className="min-w-[200px] flex-1 rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm"
          placeholder="Label, e.g. n8n production"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <button
          type="button"
          className="inline-flex items-center rounded-md border border-neutral-900 bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          disabled={pending || !label.trim()}
          onClick={create}
        >
          {pending ? "Working…" : "New API key"}
        </button>
      </div>
    </div>
  );
}

export default ApiKeysManager;
