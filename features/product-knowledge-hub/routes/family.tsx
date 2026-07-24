/**
 * Knowledge Hub — family page. Two matching spec cards (common grid + model
 * matrix, split strictly by SCOPE) followed by a version-history card, and the
 * role-aware "Raise change request" (spec.raise). Server component.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { hasUiCapability } from "@/lib/permissions";
import { getFamily } from "../lib/read";
import type { ResolvedSpec } from "../lib/types";
import { formatSpecValue as fmtValue } from "../lib/formatSpec";
import { RaiseChangeRequestForm } from "../components/RaiseChangeRequestForm";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export default async function KnowledgeHubFamily({
  params,
  searchParams,
}: {
  params: { categoryId: string };
  searchParams?: { raise?: string };
}) {
  const [family, canRaise] = await Promise.all([
    getFamily(params.categoryId),
    hasUiCapability("spec.raise"),
  ]);
  if (!family) notFound();

  const lastUpdated = family.versions[0]?.published_at ?? null;

  // Model-specification matrix: rows = model-scoped fields (in sort order),
  // columns = the family's models. Cell = that model's resolved value.
  const modelFields = family.fields
    .filter((f) => f.scope === "model")
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  const specByModelField = new Map<string, Map<string, ResolvedSpec>>();
  for (const m of family.models) {
    const inner = new Map<string, ResolvedSpec>();
    for (const s of m.modelSpecs) inner.set(s.field.id, s);
    specByModelField.set(m.id, inner);
  }

  return (
    <div className="solux-pro sx-page">
      <div className="sx-wrap">
        <div className="sx-head">
          <div>
            <div className="sx-eyebrow">
              <Link href="/productknowledgehub" className="sx-link">
                Knowledge Hub
              </Link>
            </div>
            <h1 className="sx-h1">{family.category.name}</h1>
            <p className="sx-sub">
              {family.models.length} model{family.models.length === 1 ? "" : "s"} · last updated {fmtDate(lastUpdated)}
              {family.pending ? " · a change request is in progress" : ""}
            </p>
          </div>
        </div>

        {/* Family-specific CTA — collapsed = button, open = full-width matrix form */}
        {canRaise && <RaiseChangeRequestForm family={family} defaultOpen={searchParams?.raise === "1"} />}

        {/* COMMON SPECIFICATIONS — scope: common */}
        <div className="card sec">
          <div className="sx-sectitle">
            <h2>Common specifications</h2>
            <div className="rhs">
              <span className="sx-micro">Applies to every model</span>
            </div>
          </div>
          {family.commonSpecs.length === 0 ? (
            <div className="sx-empty">No common specs defined.</div>
          ) : (
            <div className="px-meta-grid">
              {family.commonSpecs.map((s) => (
                <div key={s.field.id}>
                  <div className="metaLabel sx-micro">{s.field.label}</div>
                  <div className="metaValue sx-tnum">{fmtValue(s)}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* MODEL SPECIFICATIONS — scope: model (matrix: field × model) */}
        <div className="card sec" style={{ marginTop: 16 }}>
          <div className="sx-sectitle">
            <h2>Model specifications</h2>
            <div className="rhs">
              <span className="sx-micro">Varies by model</span>
            </div>
          </div>
          {family.models.length === 0 || modelFields.length === 0 ? (
            <div className="sx-empty">No model-specific values.</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="sx-list">
                <thead>
                  <tr>
                    <th>Field</th>
                    {family.models.map((m) => (
                      <th key={m.id} className="r">
                        <Link
                          href={`/productknowledgehub/${family.category.id}/${m.id}`}
                          className="pname"
                          title={m.name}
                        >
                          {m.sku ?? m.name}
                        </Link>
                        {m.is_legacy ? (
                          <span className="px-sbadge archived" style={{ marginLeft: 6 }}>
                            Legacy
                          </span>
                        ) : null}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {modelFields.map((f) => (
                    <tr key={f.id}>
                      <td>{f.label}</td>
                      {family.models.map((m) => (
                        <td key={m.id} className="r sx-tnum">
                          {fmtValue(specByModelField.get(m.id)?.get(f.id))}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* VERSION HISTORY */}
        <div className="card sec" style={{ marginTop: 16 }}>
          <div className="sx-sectitle">
            <h2>Version history</h2>
          </div>
          <table className="sx-list">
            <thead>
              <tr>
                <th>Version</th>
                <th>Published</th>
                <th>Reason</th>
                <th className="r">Changes</th>
              </tr>
            </thead>
            <tbody>
              {family.versions.length === 0 ? (
                <tr>
                  <td colSpan={4}>
                    <div className="sx-empty">No published versions yet.</div>
                  </td>
                </tr>
              ) : (
                family.versions.map((v) => (
                  <tr key={v.id}>
                    <td>{v.version}</td>
                    <td>{fmtDate(v.published_at)}</td>
                    <td>{v.reason ?? "—"}</td>
                    <td className="r sx-tnum">{Array.isArray(v.changes_json) ? v.changes_json.length : 0}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
