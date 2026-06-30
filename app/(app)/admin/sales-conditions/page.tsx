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
import { canAccessOrAdmin } from "@/lib/permissions";

export default async function SalesConditionsPage() {
  // Master data — admin-only. Access Denied (not a silent redirect) on miss.
  const { effectiveRole } = await getEffectiveRole();
  if (!(await canAccessOrAdmin(["admin.manage_sales_conditions"]))) {
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
    <div className="solux-pro sx-page">
      <div className="sx-wrap">
        <section className="card sec ad-section">
          <div className="eyebrow">Admin</div>
          <h2 className="ad-doc-title">Sales conditions</h2>
          <p className="ad-lead">
            Reusable paragraphs appended to quotations when the sales rep ticks "Include sales conditions".
            The <b>default</b> is auto-selected.
          </p>

          {/* New template */}
          <form action={createSalesCondition} className="card ad-subform ad-form-narrow">
            <div className="st">New template</div>
            <div className="ad-field">
              <input name="title" type="text" placeholder="Title (e.g. Standard export terms)" required />
            </div>
            <div className="ad-field">
              <textarea
                name="content"
                placeholder="Full text of the sales conditions. Newlines are preserved on the PDF."
                required
                style={{ minHeight: 120 }}
              />
            </div>
            <label
              style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13, marginBottom: 13, cursor: "pointer" }}
            >
              <input type="checkbox" name="is_default" />
              Set as default
            </label>
            <button className="sx-btn sx-btn-go">Add template</button>
          </form>

          {/* Templates */}
          {(rows ?? []).map((r) => (
            <div key={r.id} className="ad-cond-card">
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14 }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 700 }}>{r.title}</span>
                    {r.is_default && <span className="ad-tag dft">Default</span>}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--sx-mute)", marginTop: 4 }}>
                    Created {new Date(r.created_at).toLocaleDateString("en-GB")}
                  </div>
                </div>
                <div className="ad-acts">
                  {!r.is_default && (
                    <form action={setDefaultSalesCondition}>
                      <input type="hidden" name="id" value={r.id} />
                      <button className="sx-btn sx-btn-sm">Set default</button>
                    </form>
                  )}
                  <Link href={`/admin/sales-conditions/${r.id}`} className="sx-btn sx-btn-sm">
                    Edit
                  </Link>
                  <form action={deleteSalesCondition}>
                    <input type="hidden" name="id" value={r.id} />
                    <button className="sx-btn sx-btn-danger sx-btn-sm">Delete</button>
                  </form>
                </div>
              </div>
              <div className="ad-cond-body">{r.content}</div>
            </div>
          ))}
          {(!rows || rows.length === 0) && (
            <div className="ad-cond-card" style={{ textAlign: "center", color: "var(--sx-mute)", fontSize: 13 }}>
              No templates yet. Create one above.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
