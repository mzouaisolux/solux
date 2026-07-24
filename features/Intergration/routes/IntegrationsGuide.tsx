/**
 * Settings · Integrations · Guide.
 *
 * A self-contained how-to for the whole Integrations surface: concepts, the
 * event catalog, the four main use cases (with steps), setup + security, and a
 * ready-to-import n8n workflow (inbound logger + signed webhook receiver).
 *
 * Rendered by app/(app)/settings/integrations/guide/page.tsx.
 */

import Link from "next/link";
import { WEBHOOK_EVENTS, WEBHOOK_EVENT_LABELS } from "@/features/Intergration/lib/integrations";
import { CopyButton } from "@/features/Intergration/components/CopyButton";

const SIGNATURE_SNIPPET = `const crypto = require('crypto');
const raw = JSON.stringify($json.body);
const expected = 'sha256=' + crypto
  .createHmac('sha256', 'whsec_...')
  .update(raw)
  .digest('hex');
if (expected !== $json.headers['x-solux-signature']) {
  throw new Error('Invalid Solux signature');
}`;

const INBOUND_CURL = `curl -X POST https://YOUR-APP/api/integrations/interactions \\
  -H "Authorization: Bearer sk_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "phone": "+84922550812",
    "channel": "whatsapp",
    "summary": "Asked about SP-60 lead time"
  }'`;

function Panel({ title, aside, children }: { title: string; aside?: string; children: React.ReactNode }) {
  return (
    <section className="panel mt-4 space-y-3 p-5">
      <div className="flex items-center justify-between">
        <div className="eyebrow">{title}</div>
        {aside ? <span className="text-xs text-neutral-400">{aside}</span> : null}
      </div>
      {children}
    </section>
  );
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-semibold text-neutral-900">{children}</h3>;
}

function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-md border border-neutral-200 bg-neutral-50 p-3 text-xs leading-relaxed">
      <code>{children}</code>
    </pre>
  );
}

export default function IntegrationsGuide() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <Link href="/settings/integrations" className="text-xs font-semibold uppercase tracking-wide text-neutral-500 hover:text-neutral-900">
        ← Settings · Integrations
      </Link>
      <h1 className="mt-1 text-2xl font-bold">Integration Guide</h1>
      <p className="mt-2 max-w-xl text-sm text-neutral-500">
        Connect Solux with external tools such as <strong>n8n, Zalo OA, WhatsApp Business, Telegram, and email</strong>.
        This guide explains how each integration piece works, which Solux events you can subscribe to, how to
        configure the four common integration use cases, and how to secure and test your integrations.
      </p>

      <Panel title="🧩 The pieces" aside="how it fits together">
        <div className="space-y-4 text-sm text-neutral-700">
          <div className="space-y-1.5">
            <SubHeading>💬 My channels</SubHeading>
            <p>
              Your personal <strong>Zalo / WhatsApp / Telegram</strong> handles.
            </p>
            <ul className="list-disc space-y-0.5 pl-5 text-neutral-600">
              <li>Power the <strong>click-to-chat buttons</strong> on a client page.</li>
              <li>Open the selected messaging application.</li>
              <li>Nothing is sent directly from Solux.</li>
            </ul>
          </div>

          <div className="space-y-1.5">
            <SubHeading>📤 Outbound webhooks</SubHeading>
            <p>
              When something happens in Solux — such as a quotation being sent or an order being won — Solux
              sends a <strong>signed JSON payload</strong> and posts it to a URL you register, usually an
              <strong> n8n Webhook node</strong>.
            </p>
            <p>Your automation can then:</p>
            <ul className="list-disc space-y-0.5 pl-5 text-neutral-600">
              <li>Message the customer.</li>
              <li>Update a spreadsheet.</li>
              <li>Notify your team.</li>
              <li>Trigger another workflow.</li>
            </ul>
          </div>

          <div className="space-y-1.5">
            <SubHeading>📥 Inbound API</SubHeading>
            <p>An automation can send a received customer message back to Solux. Solux then:</p>
            <ul className="list-disc space-y-0.5 pl-5 text-neutral-600">
              <li>Matches the message to a client using their <strong>phone number</strong>.</li>
              <li>Adds the interaction to that client’s <strong>timeline</strong>.</li>
              <li>Separates unknown numbers under <strong>Unmatched inbound</strong>.</li>
            </ul>
          </div>

          <div className="space-y-1.5">
            <SubHeading>🔐 API keys and webhook security</SubHeading>
            <p>
              <strong>API keys</strong> secure traffic coming <em>into</em> Solux using a <strong>bearer token</strong>.
              The <strong>webhook signing secret</strong> secures traffic going <em>out</em> of Solux using an
              <strong> HMAC signature</strong>.
            </p>
            <p className="text-xs text-neutral-400">
              Both are shown only once when created. Copy and store them securely.
            </p>
          </div>
        </div>
      </Panel>

      <Panel title="🔔 Events you can subscribe to" aside="outbound webhooks">
        <div className="overflow-hidden rounded-md border border-neutral-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
                <th className="px-3 py-2">Event</th>
                <th className="px-3 py-2">Fires when</th>
              </tr>
            </thead>
            <tbody>
              {WEBHOOK_EVENTS.map((e) => (
                <tr key={e} className="border-t border-neutral-100">
                  <td className="px-3 py-2 font-mono text-xs">{e}</td>
                  <td className="px-3 py-2 text-neutral-600">{WEBHOOK_EVENT_LABELS[e]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-neutral-400">
          Every delivery is sent as a POST with headers <code>x-solux-event</code>, <code>x-solux-delivery</code> and
          <code> x-solux-signature</code>. Failed deliveries retry automatically with exponential backoff, up to
          five attempts.
        </p>
      </Panel>

      <Panel title="💬 Use case 1 — Click to chat from a client" aside="Phase 1 · everyone">
        <p className="text-sm text-neutral-700">
          Use this when you want to open Zalo, WhatsApp, Telegram, or email directly from a Solux client page.
        </p>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-neutral-700">
          <li>Open <Link href="/settings/integrations" className="underline">Settings → Integrations</Link>.</li>
          <li>Add your contact details under <strong>My channels</strong>.</li>
          <li>Open any client page.</li>
          <li>Select the <strong>Zalo, WhatsApp, Telegram, or Email</strong> button.</li>
          <li>Solux opens the selected application and prepares the conversation with that customer.</li>
          <li>After the conversation, use the <strong>Quick Logger</strong> on the client page.</li>
        </ol>
        <p className="text-xs text-neutral-500">
          ✅ The communication touchpoint appears on the client’s timeline.
        </p>
      </Panel>

      <Panel title="🔔 Use case 2 — Notify n8n when a quotation moves" aside="outbound webhook">
        <p className="text-sm text-neutral-700">
          Use this when you want an automation to run after a quotation changes status — for example a quotation
          is sent, won, lost, or cancelled.
        </p>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-neutral-700">
          <li>In n8n, add a <strong>Webhook</strong> node.</li>
          <li>Copy its <strong>Production URL</strong>.</li>
          <li>In Solux, open <strong>Settings → Integrations → Outbound webhooks</strong>.</li>
          <li>Paste the n8n webhook URL.</li>
          <li>Select the events you want to receive, such as <code>quotation.sent</code> and <code>quotation.won</code>.</li>
          <li>Select <strong>Add endpoint</strong>.</li>
          <li>Copy the signing secret shown during creation.</li>
          <li>In n8n, verify the Solux signature before processing the event.</li>
        </ol>
        <div className="flex items-center justify-between">
          <span className="text-xs text-neutral-400">Example signature verification · n8n Code node</span>
          <CopyButton text={SIGNATURE_SNIPPET} />
        </div>
        <Code>{SIGNATURE_SNIPPET}</Code>
        <p className="text-xs text-neutral-500">
          ✅ n8n can safely respond to quotation events — send a customer message, notify the sales team, update a
          spreadsheet, create a task, or trigger an approval or follow-up workflow.
        </p>
      </Panel>

      <Panel title="📄 Use case 3 — Send the quotation + datasheets package" aside="spec_sheet.sent · channel: package">
        <p className="text-sm text-neutral-700">
          When a quotation is marked <strong>Sent</strong> with <strong>Attach spec sheets</strong> on, Solux builds
          one merged PDF (the quote followed by each line’s pinned datasheet), stores it, and emits{" "}
          <code>spec_sheet.sent</code> with <code>channel</code> = <code>package</code> for n8n to deliver.
        </p>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-neutral-700">
          <li>Register an outbound webhook endpoint and subscribe it to <code>spec_sheet.sent</code>.</li>
          <li>Create a quotation; in <strong>Preview</strong>, keep <strong>Attach spec sheets</strong> on.</li>
          <li>Mark the quotation <strong>Sent</strong>.</li>
          <li>
            Solux emits <code>spec_sheet.sent</code> (<code>channel</code> = <code>package</code>) carrying{" "}
            <code>package_url</code> (a signed link to the merged PDF), <code>package_filename</code>,{" "}
            <code>recipient_email</code>, <code>recipient_source</code> (<code>contact</code> / <code>client</code> /{" "}
            <code>none</code>), <code>client_name</code>, and <code>quote_number</code>.
          </li>
          <li>
            n8n fetches <code>package_url</code> and emails it to <code>recipient_email</code> — gating on{" "}
            <code>recipient_source</code> = <code>contact</code> so a weak/internal address is held, not sent.
          </li>
        </ol>
        <p className="text-xs text-neutral-500">
          Recipient resolves to the client’s <strong>primary contact</strong> email, else the client record email,
          else none — keep primary contacts maintained or the send is held.
        </p>
        <p className="mt-2 text-xs text-neutral-500">
          <strong>Manual fallback:</strong> the <em>Send spec sheet</em> box on a quotation emits the same event with
          a single hand-pasted spec-sheet link instead of the auto-built package.
        </p>
      </Panel>

      <Panel title="📥 Use case 4 — Auto-log inbound customer messages" aside="inbound API">
        <p className="text-sm text-neutral-700">
          Use this when messages received through WhatsApp, Zalo, Telegram, email, or another automation should
          appear inside Solux.
        </p>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-neutral-700">
          <li>In Solux, open <strong>Settings → Integrations → API keys</strong>.</li>
          <li>Create an API key.</li>
          <li>Copy the plaintext key when it is shown.</li>
          <li>From your automation, send each received message to the Solux inbound API.</li>
          <li>Include the API key as a bearer token.</li>
        </ol>
        <div className="flex items-center justify-between">
          <span className="text-xs text-neutral-400">Example request · shell</span>
          <CopyButton text={INBOUND_CURL} />
        </div>
        <Code>{INBOUND_CURL}</Code>
        <div className="space-y-1 text-xs text-neutral-500">
          <p>
            <strong>Known phone number</strong> — Solux matches it to a client, adds the interaction to that
            client’s timeline, and the API returns <code>201</code>.
          </p>
          <p>
            <strong>Unknown phone number</strong> — the API returns <code>202</code>, the message appears under
            <strong> Unmatched inbound</strong>, and a user can associate it with the correct client later.
          </p>
        </div>
        <div className="mt-2 rounded-md border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-600">
          <div className="font-semibold text-neutral-700">Receiving real Zalo / WhatsApp inbound</div>
          <p className="mt-1">
            Point your Zalo OA / WhatsApp Business <em>webhook</em> at the n8n inbound receiver (the
            <code> Platform inbound webhook</code> node in the downloadable workflow, path <code>/solux-inbound</code>).
            The <code>Normalize inbound</code> node maps the platform payload to <code>{'{ phone, channel, direction, summary }'}</code>
            and forwards it to the Solux inbound API with your API key.
          </p>
          <p className="mt-1">
            WhatsApp sends the customer’s phone, which Solux matches to a client. Zalo sends a <code>user_id</code>
            (not a phone), so those land in Unmatched inbound until that id is associated with a contact.
          </p>
        </div>
      </Panel>

      <Panel title="✅ Setup checklist" aside="admin">
        <p className="text-sm text-neutral-700">Before using integrations in production:</p>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-neutral-700">
          <li>
            Apply Supabase migrations <code>164</code> through <code>170</code>, plus <code>178</code>{" "}
            (<code>quotation_packages</code>) and <code>179</code> (<code>attach_datasheets</code>) for the datasheet
            package.
          </li>
          <li>
            Add the environment variables <code>SUPABASE_SERVICE_ROLE_KEY</code>, <code>CRON_SECRET</code> and
            <code> INTEGRATION_ENC_KEY</code> (business-channel token encryption) in Vercel.
          </li>
          <li>Redeploy the application.</li>
          <li>Confirm that the once-per-minute dispatcher is running: <code>/api/hooks/dispatch</code>.</li>
          <li>Confirm that the cron job is configured in <code>vercel.json</code>.</li>
          <li>Create an API key.</li>
          <li>Register the required webhook endpoints.</li>
          <li>Test one outbound and one inbound event before enabling the workflow for real customer data.</li>
          <li>
            For datasheet packages: keep each client’s <strong>primary contact</strong> email set, or the package
            send is held (weak recipient).
          </li>
        </ol>
        <p className="text-xs text-neutral-400">
          Until <code>SUPABASE_SERVICE_ROLE_KEY</code> and <code>CRON_SECRET</code> are configured, the webhook
          dispatcher and inbound API intentionally return <code>503</code>.
        </p>
      </Panel>

      <Panel title="🛡️ Security" aside="read me">
        <ul className="list-disc space-y-1 pl-5 text-sm text-neutral-700">
          <li>Secrets are displayed only once.</li>
          <li>API keys are stored only as a <strong>SHA-256 hash</strong>.</li>
          <li>Revoke compromised keys immediately from the integrations table.</li>
          <li>Always verify <code>x-solux-signature</code> in the receiving application.</li>
          <li>Never trust an unsigned webhook payload.</li>
          <li>Never paste a live API key or signing secret into chats, support tickets, documents, or screenshots.</li>
          <li>If a secret is exposed, revoke it and issue a new one immediately.</li>
        </ul>
      </Panel>

      <Panel title="⚙️ Ready-to-import n8n workflow" aside="inbound logger + signed receiver">
        <p className="text-sm text-neutral-700">
          Import the provided workflow into n8n (<strong>Workflows → Import from File / URL</strong>), then replace
          the placeholders — your webhook signing secret (<code>whsec_…</code>), your Solux API key
          (<code>sk_live_…</code>), your Solux application URL, and your <code>CRON_SECRET</code> — and attach a
          Gmail credential to the package-email node.
        </p>
        <div className="space-y-1.5 text-sm text-neutral-700">
          <p>The workflow contains three flows:</p>
          <p>
            <strong>Flow 1 — Receive outbound events.</strong> Webhook → Verify signature → Route by event, then
            per-event branches. The <code>spec_sheet.sent</code> (<code>channel</code> = <code>package</code>) branch
            gates on <code>recipient_source</code>, fetches <code>package_url</code>, and emails the merged quote +
            datasheets.
          </p>
          <p>
            <strong>Flow 2 — Log inbound messages.</strong> Trigger → Build payload → POST to inbound logger. This
            sends received customer interactions back to the Solux inbound API.
          </p>
          <p>
            <strong>Flow 3 — Dispatch pump.</strong> A schedule POSTs <code>/api/hooks/dispatch</code> every minute to
            drain the outbound webhook queue.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href="/integrations/solux-n8n-workflow.json"
            download
            className="inline-flex items-center rounded-md border border-neutral-900 bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white"
          >
            Download workflow JSON
          </a>
          <a
            href="/integrations/solux-n8n-workflow.json"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center rounded-md border border-neutral-200 px-3 py-1.5 text-sm hover:border-neutral-900"
          >
            View raw workflow
          </a>
        </div>
      </Panel>
    </div>
  );
}
