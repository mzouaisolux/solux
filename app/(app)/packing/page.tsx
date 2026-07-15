// =====================================================================
// /packing — Overview: import report, counts, quick links.
// =====================================================================
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getLatestImport, issueTypeCounts } from "@/lib/packing-server";

export const dynamic = "force-dynamic";

async function counts(sb: ReturnType<typeof createClient>) {
  const tables = [
    "packing_item",
    "packing_item_version",
    "packing_product_image",
    "packing_bom",
    "packing_import_issue",
    "packing_container_type",
    "packing_pole_profile",
    "packing_calculation",
  ];
  const out: Record<string, number> = {};
  await Promise.all(
    tables.map(async (t) => {
      const { count } = await sb.from(t).select("*", { count: "exact", head: true });
      out[t] = count ?? 0;
    })
  );
  return out;
}

export default async function PackingOverview() {
  const sb = createClient();
  const [imp, c, issues] = await Promise.all([
    getLatestImport(sb),
    counts(sb),
    issueTypeCounts(sb),
  ]);
  const report: any = imp?.report ?? {};

  const stat = (label: string, value: React.ReactNode, hint?: string) => (
    <div className="border border-neutral-200 rounded-sm p-3">
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-neutral-500 mt-0.5">{label}</div>
      {hint && <div className="text-[11px] text-neutral-400 mt-0.5">{hint}</div>}
    </div>
  );

  return (
    <div className="space-y-6">
      {!imp && (
        <div className="border border-amber-300 bg-amber-50 text-amber-800 rounded-sm p-4 text-sm">
          No import found yet. Run <code className="px-1 bg-white border">node --experimental-strip-types
          scripts/import-packing-xlsx.ts --fresh</code> against local Supabase.
        </div>
      )}

      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {stat("Packaging items", c.packing_item, "all DRAFT — not validated")}
        {stat("Data versions", c.packing_item_version)}
        {stat("Images", c.packing_product_image)}
        {stat("BOM proposals", c.packing_bom, "needs validation")}
        {stat("Import issues", c.packing_import_issue, "to review")}
        {stat("Container types", c.packing_container_type)}
        {stat("Pole profiles", c.packing_pole_profile)}
        {stat("Calculations", c.packing_calculation)}
      </section>

      <section className="grid md:grid-cols-2 gap-4">
        <div className="border border-neutral-200 rounded-sm p-4">
          <h2 className="font-medium mb-3">Last import</h2>
          {imp ? (
            <dl className="text-sm space-y-1.5">
              <Row k="File" v={imp.file_name} />
              <Row k="Imported at" v={new Date(imp.imported_at).toLocaleString()} />
              <Row k="Import version" v={String(imp.import_version)} />
              <Row k="Rows imported" v={String(imp.row_count)} />
              <Row k="Images written" v={String(report.images_written ?? "—")} />
              <Row k="Poles detected" v={String(report.poles_detected ?? "—")} />
              <Row k="SHA-256" v={<code className="text-[11px]">{report.sha256?.slice(0, 16)}…</code>} />
              <Row k="Status" v={<span className="text-amber-700">{report.note ? "Original preserved · DRAFT" : "—"}</span>} />
            </dl>
          ) : (
            <p className="text-sm text-neutral-500">—</p>
          )}
        </div>

        <div className="border border-neutral-200 rounded-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-medium">Import issues by type</h2>
            <Link href="/packing/issues" className="text-sm text-blue-600 hover:underline">
              Review all →
            </Link>
          </div>
          <ul className="text-sm space-y-1">
            {Object.entries(issues)
              .sort((a, b) => b[1] - a[1])
              .map(([type, n]) => (
                <li key={type} className="flex justify-between border-b border-neutral-100 py-1">
                  <Link href={`/packing/issues?type=${type}`} className="text-neutral-700 hover:underline">
                    {type.replace(/_/g, " ")}
                  </Link>
                  <span className="tabular-nums font-medium">{n}</span>
                </li>
              ))}
            {!Object.keys(issues).length && <li className="text-neutral-400">No issues.</li>}
          </ul>
        </div>
      </section>

      <section className="flex gap-3 flex-wrap">
        <Link href="/packing/library" className="px-4 py-2 bg-neutral-900 text-white text-sm rounded-sm hover:bg-neutral-700">
          Open Packaging Library
        </Link>
        <Link href="/packing/calculator" className="px-4 py-2 border border-neutral-300 text-sm rounded-sm hover:bg-neutral-50">
          New Packing Calculation
        </Link>
      </section>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-neutral-500">{k}</dt>
      <dd className="text-neutral-900 text-right">{v}</dd>
    </div>
  );
}
