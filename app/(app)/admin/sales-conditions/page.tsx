import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  createSalesCondition,
  deleteSalesCondition,
  setDefaultSalesCondition,
} from "./actions";
import { getEffectiveRole } from "@/lib/auth";
import { isAdminLike } from "@/lib/types";
import AccessDenied from "@/components/AccessDenied";

export default async function SalesConditionsPage() {
  // Master data — admin-only. Access Denied (not a silent redirect) on miss.
  const { effectiveRole } = await getEffectiveRole();
  if (!isAdminLike(effectiveRole)) {
    return (
      <AccessDenied
        title="Administrators only"
        message="Master-data management is restricted to administrators."
      />
    );
  }

  const supabase = createClient();
  const { data: rows } = await supabase
    .from("sales_conditions")
    .select("id, title, content, is_default, created_at")
    .order("is_default", { ascending: false })
    .order("title");

  return (
    <div className="mx-auto max-w-screen-2xl px-6 py-8 space-y-8">
      <div className="flex items-end justify-between pb-4 border-b border-neutral-200">
        <div>
          <div className="eyebrow">Admin</div>
          <h1 className="doc-title mt-1">Sales conditions</h1>
          <p className="text-xs text-neutral-500 mt-2">
            Reusable paragraphs appended to quotations when the sales rep ticks
            "Include sales conditions". The <b>default</b> is auto-selected.
          </p>
        </div>
      </div>

      <section className="panel p-5 space-y-3">
        <h2 className="text-lg font-semibold">New template</h2>
        <form action={createSalesCondition} className="space-y-3">
          <input
            name="title"
            placeholder="Title (e.g. Standard export terms)"
            required
            className="w-full rounded border border-neutral-200 px-3 py-2"
          />
          <textarea
            name="content"
            placeholder="Full text of the sales conditions. Newlines are preserved on the PDF."
            rows={8}
            required
            className="w-full rounded border border-neutral-200 px-3 py-2 font-sans"
          />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="is_default" />
            Set as default
          </label>
          <div>
            <button className="rounded bg-solux px-4 py-2 text-white font-medium hover:bg-solux-dark">
              Add template
            </button>
          </div>
        </form>
      </section>

      <section className="space-y-3">
        {(rows ?? []).map((r) => (
          <div key={r.id} className="panel p-5 space-y-2">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold">{r.title}</h3>
                  {r.is_default && (
                    <span className="rounded bg-solux-accent px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widerx text-neutral-700">
                      Default
                    </span>
                  )}
                </div>
                <p className="text-xs text-neutral-500">
                  Created {new Date(r.created_at).toLocaleDateString("en-GB")}
                </p>
              </div>
              <div className="flex items-center gap-2 text-sm">
                {!r.is_default && (
                  <form action={setDefaultSalesCondition}>
                    <input type="hidden" name="id" value={r.id} />
                    <button className="rounded border border-neutral-200 px-3 py-1.5 hover:bg-neutral-50">
                      Set default
                    </button>
                  </form>
                )}
                <Link
                  href={`/admin/sales-conditions/${r.id}`}
                  className="rounded border border-neutral-200 px-3 py-1.5 hover:bg-neutral-50"
                >
                  Edit
                </Link>
                <form action={deleteSalesCondition}>
                  <input type="hidden" name="id" value={r.id} />
                  <button className="rounded border border-neutral-200 px-3 py-1.5 text-red-600 hover:bg-red-50">
                    Delete
                  </button>
                </form>
              </div>
            </div>
            <pre className="whitespace-pre-wrap text-xs text-neutral-700 font-sans bg-neutral-50 rounded p-3 border border-neutral-100">
              {r.content}
            </pre>
          </div>
        ))}
        {(!rows || rows.length === 0) && (
          <div className="panel p-8 text-center text-sm text-neutral-500">
            No templates yet. Create one above.
          </div>
        )}
      </section>
    </div>
  );
}
