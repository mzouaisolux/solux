/**
 * Settings · Integrations.
 *
 * Phase 1: self-scoped "My channels" for every authenticated user.
 * Phase 2: admin workspace sections — gated by integration.manage (API keys
 *   additionally by integration.manage_api_keys):
 *   - Messaging-channel connections (placeholders until Phase 3).
 *   - API keys (ApiKeysManager): create/list/revoke; plaintext shown once.
 *   - Outbound webhooks (WebhooksManager): endpoints + recent deliveries; the
 *     HMAC signing secret is shown once. The dispatcher that drains
 *     webhook_deliveries + the inbound API arrive in Step 4b.
 *
 * Rendered by the thin route wrapper at app/(app)/settings/integrations/page.tsx.
 */

import Link from "next/link";
import { hasUiCapability } from "@/lib/permissions";
import { listMyChannels } from "@/features/Intergration/actions/user-channels";
import { MyChannelsForm } from "@/features/Intergration/components/MyChannelsForm";
import { listApiKeys } from "@/features/Intergration/actions/api-keys";
import { ApiKeysManager } from "@/features/Intergration/components/ApiKeysManager";
import { listWebhookEndpoints, listRecentDeliveries } from "@/features/Intergration/actions/webhooks";
import { WebhooksManager } from "@/features/Intergration/components/WebhooksManager";
import { listConnections } from "@/features/Intergration/actions/connections";
import { ConnectionsManager } from "@/features/Intergration/components/ConnectionsManager";
import { listTemplates } from "@/features/Intergration/actions/templates";
import { TemplatesManager } from "@/features/Intergration/components/TemplatesManager";
import { listUnmatchedInbound } from "@/features/Intergration/actions/unmatched-inbound";
import { UnmatchedInboundManager } from "@/features/Intergration/components/UnmatchedInboundManager";

export default async function IntegrationsSettings() {
  const [channels, canManage, canKeys] = await Promise.all([
    listMyChannels(),
    hasUiCapability("integration.manage"),
    hasUiCapability("integration.manage_api_keys"),
  ]);
  const apiKeys = canKeys ? await listApiKeys() : [];
  const [webhookEndpoints, webhookDeliveries, connections, templates, unmatched] = canManage
    ? await Promise.all([
        listWebhookEndpoints(),
        listRecentDeliveries(),
        listConnections(),
        listTemplates(),
        listUnmatchedInbound(),
      ])
    : [[], [], [], [], []];

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Settings</div>
          <h1 className="mt-1 text-2xl font-bold">Integrations</h1>
          <p className="mt-2 max-w-xl text-sm text-neutral-500">
            {canManage
              ? "Business messaging accounts, API keys and the webhooks that feed n8n, plus your own click-to-chat channels."
              : "Connect the channels you use to reach customers."}
          </p>
        </div>
        <Link
          href="/settings/integrations/guide"
          className="shrink-0 rounded-lg border border-neutral-200 px-4 py-3 text-sm hover:border-neutral-900"
        >
          <div className="font-semibold">Integration Guide →</div>
          <div className="mt-0.5 text-xs text-neutral-500">Use cases, setup & n8n workflow</div>
        </Link>
      </div>

      {/* ===== Workspace sections — admin only (integration.manage) ===== */}
      {canManage ? (
        <>
          <section className="panel mt-6 space-y-3 p-5">
            <div className="flex items-center justify-between">
              <div className="eyebrow">Messaging channels</div>
              <span className="text-xs text-neutral-400">workspace · gated by integration.manage</span>
            </div>
            <p className="text-sm text-neutral-500">
              Connect the company business accounts used to message customers. Access tokens are encrypted
              at rest and never shown again.
            </p>
            <ConnectionsManager initial={connections} />
          </section>

          {canKeys ? (
            <section className="panel mt-4 space-y-3 p-5">
              <div className="flex items-center justify-between">
                <div className="eyebrow">API keys</div>
                <span className="text-xs text-neutral-400">gated by integration.manage_api_keys</span>
              </div>
              <ApiKeysManager initial={apiKeys} />
              <p className="text-xs text-neutral-400">
                Plaintext is shown once at creation; only a SHA-256 hash is stored. Use a key as a Bearer token on the inbound API.
              </p>
            </section>
          ) : null}

          <section className="panel mt-4 space-y-3 p-5">
            <div className="flex items-center justify-between">
              <div className="eyebrow">Outbound webhooks</div>
              <span className="text-xs text-neutral-400">events → n8n · HMAC-signed</span>
            </div>
            <WebhooksManager initial={webhookEndpoints} deliveries={webhookDeliveries} />
          </section>

          <section className="panel mt-4 space-y-3 p-5">
            <div className="flex items-center justify-between">
              <div className="eyebrow">Message templates</div>
              <span className="text-xs text-neutral-400">reusable snippets · {"{{tokens}}"}</span>
            </div>
            <TemplatesManager initial={templates} />
          </section>

          <section className="panel mt-4 space-y-2 p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="eyebrow">Unmatched inbound</div>
                {unmatched.length > 0 ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                    {unmatched.length}
                  </span>
                ) : null}
              </div>
              <span className="text-xs text-neutral-400">sender phone not found on any client</span>
            </div>
            <UnmatchedInboundManager initial={unmatched} />
          </section>
        </>
      ) : null}

      {/* ===== My channels — every authenticated user ===== */}
      <section className="panel mt-4 space-y-3 p-5">
        <div className="flex items-center justify-between">
          <div className="eyebrow">My channels</div>
          <span className="text-xs text-neutral-400">self-scoped · powers click-to-chat</span>
        </div>
        <p className="text-sm text-neutral-500">
          Your own handles power the click-to-chat buttons on client pages. Only you can edit these.
        </p>
        <MyChannelsForm initial={channels} />
      </section>
    </div>
  );
}
