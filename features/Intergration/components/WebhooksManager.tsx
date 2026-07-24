"use client";

// Integrations Phase 2 — outbound webhook endpoints (admin). Create returns the
// HMAC signing secret once. Deliveries table is read-only (filled by Step 4b).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/feedback/toast-store";
import {
  createWebhookEndpoint,
  setWebhookActive,
  deleteWebhookEndpoint,
  type WebhookEndpointRow,
  type WebhookDeliveryRow,
} from "@/features/Intergration/actions/webhooks";
import { WEBHOOK_EVENTS } from "@/features/Intergration/lib/integrations";

const btn =
  "inline-flex items-center rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm font-medium hover:border-neutral-900 disabled:opacity-40";

const statusBadge: Record<WebhookDeliveryRow["status"], string> = {
  delivered: "border-green-300 bg-green-50 text-green-800",
  pending: "border-neutral-200 text-neutral-500",
  failed: "border-red-300 bg-red-50 text-red-800",
};

export function WebhooksManager({
  initial,
  deliveries,
}: {
  initial: WebhookEndpointRow[];
  deliveries: WebhookDeliveryRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>([]);
  const [secret, setSecret] = useState<string | null>(null);

  function toggleEvent(e: string) {
    setEvents((cur) => (cur.includes(e) ? cur.filter((x) => x !== e) : [...cur, e]));
  }

  function create() {
    startTransition(async () => {
      try {
        const res = await createWebhookEndpoint({ url, eventTypes: events });
        setSecret(res.secret);
        setUrl("");
        setEvents([]);
        toast.success("Endpoint added");
        router.refresh();
      } catch (e: any) {
        toast.error(e?.message ?? "Could not add endpoint");
      }
    });
  }

  function act(fn: Promise<void>, ok: string) {
    startTransition(async () => {
      try {
        await fn;
        toast.success(ok);
        router.refresh();
      } catch (e: any) {
        toast.error(e?.message ?? "Action failed");
      }
    });
  }

  return (
    <div className="space-y-3">
      {secret ? (
        <div className="rounded-md border-l-2 border-green-600 bg-green-50 px-3 py-2.5">
          <div className="text-sm font-semibold text-green-800">Signing secret — copy it now, shown once.</div>
          <code className="mt-1 block break-all rounded bg-white px-2 py-1 text-xs">{secret}</code>
          <button type="button" className={`${btn} mt-2`} onClick={() => setSecret(null)}>
            I copied it
          </button>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-md border border-neutral-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
              <th className="px-3 py-2">Endpoint</th>
              <th className="px-3 py-2">Events</th>
              <th className="px-3 py-2">Active</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {initial.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-sm text-neutral-500">
                  No endpoints configured.
                </td>
              </tr>
            ) : (
              initial.map((w) => (
                <tr key={w.id} className="border-t border-neutral-100">
                  <td className="px-3 py-2 font-mono text-xs break-all">{w.url}</td>
                  <td className="px-3 py-2 text-neutral-500">{w.event_types.join(", ")}</td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      className={btn}
                      disabled={pending}
                      onClick={() => act(setWebhookActive(w.id, !w.is_active), w.is_active ? "Paused" : "Enabled")}
                    >
                      {w.is_active ? "On" : "Off"}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      className={btn}
                      disabled={pending}
                      onClick={() => act(deleteWebhookEndpoint(w.id), "Endpoint removed")}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="rounded-md border border-neutral-200 p-3">
        <input
          className="w-full rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm"
          placeholder="https://n8n.solux.vn/hook/…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <div className="mt-2 flex flex-wrap gap-3">
          {WEBHOOK_EVENTS.map((e) => (
            <label key={e} className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={events.includes(e)} onChange={() => toggleEvent(e)} />
              <span className="font-mono text-xs">{e}</span>
            </label>
          ))}
        </div>
        <button
          type="button"
          className="mt-3 inline-flex items-center rounded-md border border-neutral-900 bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          disabled={pending || !url.trim() || events.length === 0}
          onClick={create}
        >
          {pending ? "Working…" : "Add endpoint"}
        </button>
      </div>

      {deliveries.length > 0 ? (
        <div>
          <div className="eyebrow mb-2">Recent deliveries</div>
          <div className="overflow-hidden rounded-md border border-neutral-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
                  <th className="px-3 py-2">Event</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Attempts</th>
                  <th className="px-3 py-2">Code</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((d) => (
                  <tr key={d.id} className="border-t border-neutral-100">
                    <td className="px-3 py-2 font-mono text-xs">{d.event_type}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${statusBadge[d.status]}`}
                      >
                        {d.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-neutral-500">{d.attempts}</td>
                    <td className="px-3 py-2 text-neutral-500">{d.response_code ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default WebhooksManager;
