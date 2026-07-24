/**
 * Knowledge Hub — model page. General two-column structure: specs on the left
 * (Common + Model, split by SCOPE), the branded datasheet + version history on
 * the right. The datasheet preview echoes the spec-sheet document style (mauve).
 * Server component.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { hasUiCapability } from "@/lib/permissions";
import { getModel, getSpecDocument } from "../lib/read";
import type { ResolvedSpec } from "../lib/types";
import { formatSpecValue as fmtValue } from "../lib/formatSpec";
import {
  SPEC_SHEET_TEMPLATE_VERSION,
  SPEC_GROUPS,
  HEADLINE_KEYS,
  DIMENSION_KEYS,
  PRODUCT_CODE_KEY,
  WARRANTY_KEY,
  CERTIFICATIONS_KEY,
} from "../lib/specGroups";
import { DownloadSpecSheetButton } from "../components/DownloadSpecSheetButton";
import { AutoDatasheetStatus } from "../components/AutoDatasheetStatus";
import { SendDatasheetForm } from "../components/SendDatasheetForm";
import { listActiveTemplates } from "@/features/Intergration/actions/templates";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function SpecGrid({ specs }: { specs: ResolvedSpec[] }) {
  if (specs.length === 0) return <div className="sx-empty">No values.</div>;
  return (
    <div className="px-meta-grid">
      {specs.map((s) => (
        <div key={s.field.id}>
          <div className="metaLabel sx-micro">{s.field.label}</div>
          <div className="metaValue sx-tnum">{fmtValue(s)}</div>
        </div>
      ))}
    </div>
  );
}

export default async function KnowledgeHubModel({
  params,
}: {
  params: { categoryId: string; productId: string };
}) {
  const model = await getModel(params.productId);
  if (!model) notFound();

  const currentVersion = model.currentVersion;
  const doc = currentVersion ? await getSpecDocument(params.productId, currentVersion) : null;
  // Auto sheets built by an older template are stale → hide the stored doc so
  // the download control re-renders with the current layout. Attached overrides
  // (figma_override) are never treated as stale.
  const docStale = !!doc && doc.kind === "auto" && doc.template_version !== SPEC_SHEET_TEMPLATE_VERSION;
  const docProp = doc && !docStale ? { status: doc.status, storage_path: doc.storage_path } : null;
  const lastUpdated =
    model.versions.find((v) => v.version === currentVersion)?.published_at ??
    model.versions[0]?.published_at ??
    null;

  const canSend = await hasUiCapability("integration.send_business");
  const canQuote = await hasUiCapability("quotation.create");
  const sendTemplates = canSend ? await listActiveTemplates() : [];

  const quoteHref = model.product.sku
    ? `/documents/new?product=${encodeURIComponent(model.product.sku)}`
    : "/documents/new";

  // Datasheet preview data — a mini technical page assembled from the model's
  // specs (same grouping the generated PDF uses).
  const byKey = new Map([...model.commonSpecs, ...model.modelSpecs].map((s) => [s.field.key, s] as const));
  const oneVal = (k: string) => {
    const s = byKey.get(k);
    const v = s ? fmtValue(s) : "—";
    return v && v !== "—" ? v : null;
  };
  const rowsFor = (keys: string[]) =>
    keys
      .map((k) => byKey.get(k))
      .filter((s): s is ResolvedSpec => Boolean(s))
      .map((s) => ({ label: s.field.label, value: fmtValue(s) }))
      .filter((r) => r.value && r.value !== "—");
  const dsHeadline = rowsFor(HEADLINE_KEYS);
  const dsDimensions = rowsFor(DIMENSION_KEYS);
  const dsGroups = SPEC_GROUPS.map((g) => ({ title: g.title, rows: rowsFor(g.keys) })).filter((g) => g.rows.length > 0);
  const dsProductCode = oneVal(PRODUCT_CODE_KEY) ?? model.product.sku ?? model.product.name;
  const dsCerts = oneVal(CERTIFICATIONS_KEY);
  const dsWarranty = (() => {
    const s = byKey.get(WARRANTY_KEY);
    if (!s?.value) return null;
    if (s.value.value_number != null) return String(s.value.value_number);
    const m = /(\d+)/.exec(s.value.value_text ?? "");
    return m ? m[1] : null;
  })();

  return (
    <div className="solux-pro sx-page">
      <div className="sx-wrap">
        <div className="sx-head">
          <div>
            <div className="sx-eyebrow">
              <Link href="/productknowledgehub" className="sx-link">
                Knowledge Hub
              </Link>{" "}
              ·{" "}
              <Link href={`/productknowledgehub/${params.categoryId}`} className="sx-link">
                {model.categoryName ?? "Family"}
              </Link>
            </div>
            <h1 className="sx-h1">{model.product.name}</h1>
            <p className="sx-sub">
              last updated {fmtDate(lastUpdated)} · SKU {model.product.sku ?? "—"}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
            {canQuote ? (
              <Link className="sx-btn" href={quoteHref}>
                Add to quote
              </Link>
            ) : null}
            {canSend ? (
              <SendDatasheetForm
                productId={params.productId}
                sku={model.product.sku ?? null}
                version={currentVersion}
                productName={model.product.name}
                templates={sendTemplates}
              />
            ) : null}
          </div>
        </div>

        {/* Left column (2fr): Common → Model → Version history stacked.
            Right column (1fr): Datasheet, row 1, stretched to the Common card. */}
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
          {/* COMMON — scope: common */}
          <div className="card sec" style={{ gridColumn: 1, gridRow: 1 }}>
            <div className="sx-sectitle">
              <h2>Common specifications</h2>
              <div className="rhs">
                <span className="sx-micro">Applies to every model</span>
              </div>
            </div>
            <SpecGrid specs={model.commonSpecs} />
          </div>

          {/* DATASHEET — mini technical page (left info + mauve grouped panel), CTAs flush below */}
          <div
            className="card sec"
            style={{ gridColumn: 2, gridRow: 1, alignSelf: "start", display: "flex", flexDirection: "column" }}
          >
            <div className="sx-sectitle">
              <h2>Datasheet</h2>
            </div>
            <div
              style={{
                border: "1px solid #CAC8D1",
                borderRadius: 12,
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                aspectRatio: "210 / 297",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "10px 12px 6px" }}>
                <span style={{ fontWeight: 300, letterSpacing: 3, fontSize: 13, color: "#232323" }}>SOLUX</span>
                <span style={{ textAlign: "right", lineHeight: 1.3 }}>
                  <span style={{ display: "block", fontWeight: 300, fontSize: 12, color: "#232323" }}>{model.product.name}</span>
                  <span style={{ fontSize: 9, color: "#6E6A78" }}>
                    {model.product.sku ? `Model I ${model.product.sku}` : currentVersion ?? ""}
                  </span>
                </span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", flex: 1 }}>
                <div style={{ padding: "4px 12px 12px", display: "flex", flexDirection: "column" }}>
                  {dsHeadline.map((h) => (
                    <div key={h.label} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                      <span style={{ width: 4, height: 4, borderRadius: "50%", background: "#232323", flex: "0 0 auto" }} />
                      <span style={{ fontSize: 10 }}>
                        <strong>{h.label}</strong> <span style={{ color: "#6E6A78" }}>I</span> {h.value}
                      </span>
                    </div>
                  ))}
                  <div style={{ background: "#3A3A3A", opacity: 0.5, flex: 1, minHeight: 40, borderRadius: 3, margin: "6px 0 10px" }} />
                  {dsDimensions.length > 0 ? (
                    <>
                      <div style={{ fontSize: 9, fontWeight: 600, color: "#413F49", marginBottom: 1 }}>Dimensions</div>
                      {dsDimensions.slice(0, 3).map((d) => (
                        <div
                          key={d.label}
                          style={{ display: "flex", justifyContent: "space-between", gap: 6, borderTop: "1px solid #CAC8D1", padding: "3px 0" }}
                        >
                          <span style={{ color: "#6E6A78", fontSize: 8.5 }}>{d.label}</span>
                          <span style={{ color: "#232323", fontSize: 8.5, textAlign: "right" }}>{d.value}</span>
                        </div>
                      ))}
                    </>
                  ) : null}
                  <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "14px 0 6px" }}>
                    <span style={{ fontSize: 16, fontWeight: 600, color: "#232323" }}>{dsProductCode}</span>
                    {dsWarranty ? (
                      <span
                        style={{
                          width: 34,
                          height: 34,
                          borderRadius: "50%",
                          border: "1.5px solid #6E6A78",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "#413F49",
                          lineHeight: 1,
                          flex: "0 0 auto",
                        }}
                      >
                        <span style={{ fontSize: 12, fontWeight: 600 }}>{dsWarranty}</span>
                        <span style={{ fontSize: 5, fontWeight: 600 }}>YEARS</span>
                      </span>
                    ) : null}
                  </div>
                  {dsCerts ? (
                    <>
                      <div style={{ fontSize: 8.5, fontWeight: 600, color: "#413F49" }}>Certifications</div>
                      <div
                        style={{
                          fontSize: 8,
                          color: "#5F5E63",
                          lineHeight: 1.4,
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        {dsCerts}
                      </div>
                    </>
                  ) : null}
                </div>
                <div style={{ background: "#AEAABA", padding: "6px 12px 12px" }}>
                  {dsGroups.slice(0, 3).map((g, gi) => (
                    <div key={g.title}>
                      <div style={{ color: "#fff", fontWeight: 600, fontSize: 9.5, margin: gi === 0 ? "0 0 2px" : "9px 0 2px" }}>
                        {g.title}
                      </div>
                      {g.rows.slice(0, 3).map((r) => (
                        <div
                          key={r.label}
                          style={{ display: "flex", justifyContent: "space-between", gap: 6, borderTop: "1px solid #BCB9C6", padding: "3.5px 0" }}
                        >
                          <span style={{ color: "#ECEBEF", fontSize: 8.5 }}>{r.label}</span>
                          <span style={{ color: "#fff", fontSize: 8.5, fontWeight: 500, textAlign: "right" }}>{r.value}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            {doc?.kind !== "figma_override" ? (
              <AutoDatasheetStatus
                productId={params.productId}
                version={currentVersion}
                status={doc?.status ?? null}
              />
            ) : null}
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
              <DownloadSpecSheetButton productId={params.productId} version={currentVersion} doc={docProp} variant="preview" block />
              <DownloadSpecSheetButton productId={params.productId} version={currentVersion} doc={docProp} variant="download" block />
            </div>
          </div>

          {/* MODEL — scope: model */}
          <div className="card sec" style={{ gridColumn: 1, gridRow: 2 }}>
            <div className="sx-sectitle">
              <h2>Model specifications</h2>
              <div className="rhs">
                <span className="sx-micro">This model</span>
              </div>
            </div>
            <SpecGrid specs={model.modelSpecs} />
          </div>

          {/* VERSION HISTORY — under Model specifications (left column) */}
          <div className="card sec" style={{ gridColumn: 1, gridRow: 3 }}>
            <div className="sx-sectitle">
              <h2>Version history</h2>
            </div>
            {model.versions.length === 0 ? (
              <div className="sx-empty">No published versions yet.</div>
            ) : (
              <div>
                {model.versions.map((v) => (
                  <div
                    key={v.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "baseline",
                      gap: 10,
                      padding: "10px 0",
                      borderTop: "1px solid var(--sx-line, #e7e7ea)",
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{v.version}</div>
                      <div className="sx-micro" style={{ marginTop: 2 }}>{v.reason ?? "—"}</div>
                    </div>
                    <div className="sx-micro" style={{ whiteSpace: "nowrap" }}>{fmtDate(v.published_at)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
