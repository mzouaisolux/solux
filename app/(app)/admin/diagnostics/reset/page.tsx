import Link from "next/link";
import { redirect } from "next/navigation";
import {
  hasUiCapability,
  requireCapability,
} from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { SubmitButton } from "@/components/SubmitButton";
import { runDevResetAction } from "./actions";

/**
 * Development data reset (super-admin only).
 *
 * Wipes operational/business data while preserving the entire
 * infrastructure (auth, roles, permissions, products, config,
 * factory mappings, sales conditions, banks).
 *
 * Why a UI on top of the SQL script
 * ---------------------------------
 * - Shows live counts of what's about to be deleted (and what stays)
 *   before any destructive action.
 * - Forces a typed "RESET" confirmation in the form so a misclick
 *   can't wipe the DB — even if a future regression bypasses the
 *   browser-native confirm() dialog.
 * - Goes through the SECURITY DEFINER RPC `admin_reset_execute`,
 *   which:
 *     - runs everything in a single transaction (atomic),
 *     - bypasses RLS without exposing a sweeping RLS policy,
 *     - emits a single audit event AFTER the wipe so the new
 *       timeline starts with a coherent marker.
 *
 * Gates
 * -----
 *   - Capability:  admin.diagnostics  (super-admin only by default)
 *   - Tab hidden:  yes (route only, no nav chip)
 *   - Server-side: requireCapability throws on the action layer too.
 */
export default async function DevResetPage({
  searchParams,
}: {
  searchParams: { result?: string };
}) {
  const canSeePage = await hasUiCapability("admin.diagnostics");
  if (!canSeePage) redirect("/dashboard");
  await requireCapability("admin.diagnostics");

  // Decode the post-execute result if we just came back from a wipe.
  let lastResult: any = null;
  if (searchParams?.result) {
    try {
      lastResult = JSON.parse(
        Buffer.from(searchParams.result, "base64url").toString("utf8")
      );
    } catch {
      // Bad payload — ignore silently rather than crashing the page.
      lastResult = null;
    }
  }

  // Live preview of what would be deleted + what would stay.
  // Defensive: if migration 035 isn't deployed yet, show the
  // remediation message instead of crashing.
  const supabase = createClient();
  const previewRpc = await supabase.rpc("admin_reset_preview");
  const preview = (previewRpc.data as any) ?? null;
  const previewError = previewRpc.error
    ? previewRpc.error.code === "42883"
      ? "RPC admin_reset_preview() is not deployed. Apply migration 035 in Supabase and reload this page."
      : previewRpc.error.message
    : null;

  return (
    <div className="mx-auto max-w-5xl p-8 space-y-6">
      <div>
        <div className="eyebrow">Admin · Diagnostics · Dev reset</div>
        <h1 className="doc-title mt-1">Reset operational data</h1>
        <p className="text-xs text-neutral-500 mt-2 max-w-2xl">
          Wipes clients, documents, task lists, production orders, and
          events. Preserves users, roles, permissions, products,
          factory mappings, sales conditions, banks — every piece of
          infrastructure. Numbering counters auto-reset to 1. There is
          NO undo.
        </p>
        <Link
          href="/admin/diagnostics"
          className="text-[11px] text-neutral-500 hover:text-neutral-900 hover:underline mt-3 inline-block"
        >
          ← Back to diagnostics
        </Link>
      </div>

      {/* Last-run result banner — only present if we just came back
          from a successful wipe. */}
      {lastResult?.ok && (
        <section className="rounded-lg border border-emerald-300 bg-emerald-50/60 p-4">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <div>
              <div className="text-[10px] uppercase tracking-widerx font-semibold text-emerald-800">
                Reset complete
              </div>
              <p className="text-sm text-emerald-900 mt-0.5">
                Operational data wiped. The app is now in a clean
                fresh-environment state.
              </p>
            </div>
            <span className="text-[11px] text-emerald-700 tabular-nums">
              {new Date(lastResult.reset_at).toLocaleString()}
            </span>
          </div>
          <dl className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-3 text-xs">
            <Stat label="Clients" value={lastResult.deleted_clients} />
            <Stat label="Documents" value={lastResult.deleted_documents} />
            <Stat label="Task lists" value={lastResult.deleted_task_lists} />
            <Stat
              label="Production orders"
              value={lastResult.deleted_production_orders}
            />
            <Stat label="Events" value={lastResult.deleted_events} />
          </dl>
        </section>
      )}

      {/* Preview / pre-flight */}
      {previewError ? (
        <section className="rounded-md border border-amber-300 bg-amber-50/60 px-3 py-3 text-xs text-amber-900">
          <div className="font-semibold mb-1">Preview unavailable</div>
          <p className="text-amber-800">{previewError}</p>
        </section>
      ) : preview ? (
        <section className="panel p-5 space-y-3">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <div>
              <div className="eyebrow">Current state · would be deleted</div>
              <h2 className="text-base font-semibold text-neutral-900 mt-0.5">
                Business data
              </h2>
            </div>
          </div>
          <dl className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
            <Stat label="Clients" value={preview.clients} tone="rose" />
            <Stat label="Documents" value={preview.documents} tone="rose" />
            <Stat
              label="Document lines"
              value={preview.document_lines}
              tone="rose"
              hint="cascaded"
            />
            <Stat
              label="Document containers"
              value={preview.document_containers}
              tone="rose"
              hint="cascaded"
            />
            <Stat
              label="Task lists"
              value={preview.production_task_lists}
              tone="rose"
            />
            <Stat
              label="Task list lines"
              value={preview.production_task_list_lines}
              tone="rose"
              hint="cascaded"
            />
            <Stat
              label="Production orders"
              value={preview.production_orders}
              tone="rose"
            />
            <Stat
              label="Deadline changes"
              value={preview.production_deadline_changes}
              tone="rose"
              hint="cascaded"
            />
            <Stat label="Events" value={preview.events} tone="rose" />
          </dl>
        </section>
      ) : null}

      {preview?.preserved && (
        <section className="panel p-5 space-y-3">
          <div>
            <div className="eyebrow">Preserved · untouched by the reset</div>
            <h2 className="text-base font-semibold text-neutral-900 mt-0.5">
              Infrastructure
            </h2>
            <p className="text-[11px] text-neutral-500 mt-0.5">
              Plus everything in <code>auth.users</code>, migrations,
              schemas, RLS policies.
            </p>
          </div>
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
            <Stat label="Users" value={preview.preserved.user_roles} tone="emerald" />
            <Stat
              label="Permissions catalog"
              value={preview.preserved.permissions}
              tone="emerald"
            />
            <Stat
              label="Role matrix rows"
              value={preview.preserved.role_permissions}
              tone="emerald"
            />
            <Stat label="Products" value={preview.preserved.products} tone="emerald" />
            <Stat label="Options" value={preview.preserved.options} tone="emerald" />
            <Stat
              label="Price versions"
              value={preview.preserved.prices_version}
              tone="emerald"
            />
            <Stat
              label="Product categories"
              value={preview.preserved.product_categories}
              tone="emerald"
            />
            <Stat
              label="Config fields"
              value={preview.preserved.config_fields}
              tone="emerald"
            />
            <Stat
              label="Config options"
              value={preview.preserved.config_field_options}
              tone="emerald"
            />
            <Stat
              label="Factory mappings"
              value={preview.preserved.factory_mappings}
              tone="emerald"
            />
            <Stat
              label="Component mappings"
              value={preview.preserved.component_mappings}
              tone="emerald"
            />
            <Stat
              label="Sales conditions"
              value={preview.preserved.sales_conditions}
              tone="emerald"
            />
            <Stat
              label="Bank accounts"
              value={preview.preserved.bank_accounts}
              tone="emerald"
            />
          </dl>
        </section>
      )}

      {/* Confirmation form — only enabled when preview loaded */}
      {!previewError && preview && (
        <section className="rounded-lg border border-rose-300 bg-rose-50/40 p-5 space-y-4">
          <div>
            <div className="text-[10px] uppercase tracking-widerx font-semibold text-rose-800">
              Danger zone · destructive
            </div>
            <h2 className="text-base font-semibold text-rose-900 mt-0.5">
              Confirm the reset
            </h2>
            <p className="text-xs text-rose-800 mt-1 max-w-2xl">
              Type <code className="font-mono font-bold">RESET</code> in
              the field below to enable the wipe. The action runs in a
              single transaction — any error rolls back every delete.
            </p>
          </div>
          <form action={runDevResetAction} className="space-y-3">
            <label className="block">
              <span className="block text-[10px] uppercase tracking-widerx text-rose-800 font-semibold mb-1">
                Confirmation phrase
              </span>
              <input
                type="text"
                name="confirmation"
                placeholder="Type RESET to enable the button"
                autoComplete="off"
                spellCheck={false}
                className="w-full max-w-sm rounded-md border-2 border-rose-300 bg-white px-3 py-2 text-sm font-mono uppercase focus:border-rose-500 focus:outline-none"
              />
            </label>
            <SubmitButton variant="danger" pendingLabel="Wiping…">
              Wipe operational data
            </SubmitButton>
          </form>
        </section>
      )}

      <p className="text-[10px] text-neutral-400 italic">
        Backup option: <code>supabase/dev/reset_business_data.sql</code>{" "}
        — standalone SQL fallback you can paste into the Supabase SQL
        Editor if the in-app reset isn&apos;t available.
      </p>
    </div>
  );
}

/* ===========================================================================
   Stat cell — small typed helper for the dl rows above.
   =========================================================================== */
function Stat({
  label,
  value,
  tone = "neutral",
  hint,
}: {
  label: string;
  value: number | string;
  tone?: "neutral" | "rose" | "emerald";
  hint?: string;
}) {
  const valueClass =
    tone === "rose"
      ? "text-rose-800"
      : tone === "emerald"
        ? "text-emerald-800"
        : "text-neutral-900";
  return (
    <div className="rounded-md border border-neutral-200 bg-white px-3 py-2">
      <dt className="text-[10px] uppercase tracking-widerx text-neutral-500 font-semibold">
        {label}
        {hint && (
          <span className="ml-1 normal-case tracking-normal text-neutral-400 italic font-normal">
            ({hint})
          </span>
        )}
      </dt>
      <dd className={`mt-0.5 text-lg font-semibold tabular-nums ${valueClass}`}>
        {value}
      </dd>
    </div>
  );
}
