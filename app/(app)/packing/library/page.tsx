// =====================================================================
// /packing/library — Packaging Library: table + thumbnails + search/filters.
// =====================================================================
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { listLibraryItems, listFamilies, type LibraryFilters } from "@/lib/packing-server";

export const dynamic = "force-dynamic";

const dims = (l: any, w: any, h: any) =>
  l == null && w == null && h == null ? "—" : `${l ?? "?"}×${w ?? "?"}×${h ?? "?"}`;

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>;
}) {
  const sb = createClient();
  const f: LibraryFilters = {
    q: searchParams.q,
    family: searchParams.family,
    packaging_type: searchParams.packaging_type,
    flag: searchParams.flag as LibraryFilters["flag"],
  };
  const [rows, families] = await Promise.all([listLibraryItems(sb, f), listFamilies(sb)]);

  const FLAGS = [
    ["", "All"],
    ["missing_dims", "Missing dimensions"],
    ["unverified", "Unverified"],
    ["poles", "Lamp poles"],
    ["no_image", "No image"],
  ];
  const PTYPES = ["", "individual_carton", "outside_carton", "master_carton", "loose_cargo"];

  return (
    <div className="space-y-4">
      {/* Filters (GET form) */}
      <form className="flex flex-wrap gap-2 items-end" method="get">
        <div>
          <label className="block text-[11px] text-neutral-500 mb-0.5">Search</label>
          <input
            name="q"
            defaultValue={f.q ?? ""}
            placeholder="reference or name…"
            className="border border-neutral-300 rounded-sm px-2 py-1 text-sm w-56"
          />
        </div>
        <Select name="family" label="Family" value={f.family} options={[["", "All"], ...families.map((x) => [x, x] as [string, string])]} />
        <Select name="packaging_type" label="Packaging" value={f.packaging_type} options={PTYPES.map((x) => [x, x || "All"] as [string, string])} />
        <Select name="flag" label="Flag" value={f.flag} options={FLAGS as [string, string][]} />
        <button className="px-3 py-1.5 bg-neutral-900 text-white text-sm rounded-sm">Apply</button>
        <Link href="/packing/library" className="px-3 py-1.5 border border-neutral-300 text-sm rounded-sm">Reset</Link>
        <span className="ml-auto text-sm text-neutral-500 self-center">{rows.length} records</span>
      </form>

      <div className="overflow-x-auto border border-neutral-200 rounded-sm">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-[11px] uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="p-2 w-14">Img</th>
              <th className="p-2">Reference</th>
              <th className="p-2">Family</th>
              <th className="p-2">Packaging</th>
              <th className="p-2 text-right">/carton</th>
              <th className="p-2">Inner (mm)</th>
              <th className="p-2">Outer (mm)</th>
              <th className="p-2 text-right">Net</th>
              <th className="p-2 text-right">Gross</th>
              <th className="p-2 text-right">CBM</th>
              <th className="p-2">Flags</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r: any) => {
              const v = r.v ?? {};
              const missingDims = v.inner_l_mm == null || v.inner_w_mm == null || v.inner_h_mm == null;
              return (
                <tr key={r.id} className="border-t border-neutral-100 hover:bg-neutral-50 align-top">
                  <td className="p-1">
                    {r.img?.storage_path ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.img.storage_path} alt="" className="w-12 h-12 object-contain bg-white border border-neutral-100" />
                    ) : (
                      <div className="w-12 h-12 grid place-items-center text-[9px] text-neutral-300 border border-dashed border-neutral-200">no img</div>
                    )}
                  </td>
                  <td className="p-2 font-medium text-neutral-800">{r.reference}</td>
                  <td className="p-2 text-neutral-500">{r.family ?? "—"}</td>
                  <td className="p-2 text-neutral-600">{v.packaging_type ?? "—"}</td>
                  <td className="p-2 text-right tabular-nums">{v.qty_per_outside_carton ?? "—"}</td>
                  <td className="p-2 tabular-nums text-neutral-600">{dims(v.inner_l_mm, v.inner_w_mm, v.inner_h_mm)}</td>
                  <td className="p-2 tabular-nums text-neutral-600">{dims(v.outer_l_mm, v.outer_w_mm, v.outer_h_mm)}</td>
                  <td className="p-2 text-right tabular-nums">{v.net_weight_kg ?? "—"}</td>
                  <td className="p-2 text-right tabular-nums">{v.gross_weight_unit_kg ?? "—"}</td>
                  <td className="p-2 text-right tabular-nums">{v.cbm_outer ?? v.cbm_inner ?? "—"}</td>
                  <td className="p-2">
                    <div className="flex flex-wrap gap-1">
                      <Badge tone="amber">{v.status ?? "draft"}</Badge>
                      {r.verification_status === "unverified" && <Badge tone="gray">unverified</Badge>}
                      {r.is_lamp_pole && <Badge tone="violet">pole</Badge>}
                      {r.is_oversized && <Badge tone="blue">oversized</Badge>}
                      {missingDims && <Badge tone="red">missing dims</Badge>}
                    </div>
                  </td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr><td colSpan={11} className="p-6 text-center text-neutral-400">No records match these filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-neutral-400">
        All records are DRAFT and unverified until Operations validates them. Calculated fields (CBM) are
        derived from dimensions; edit + version history land in Phase 1b.
      </p>
    </div>
  );
}

function Select({ name, label, value, options }: { name: string; label: string; value?: string; options: [string, string][] }) {
  return (
    <div>
      <label className="block text-[11px] text-neutral-500 mb-0.5">{label}</label>
      <select name={name} defaultValue={value ?? ""} className="border border-neutral-300 rounded-sm px-2 py-1 text-sm">
        {options.map(([val, lab]) => (
          <option key={val} value={val}>{lab}</option>
        ))}
      </select>
    </div>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone: "amber" | "gray" | "violet" | "blue" | "red" }) {
  const tones: Record<string, string> = {
    amber: "border-amber-300 text-amber-700 bg-amber-50",
    gray: "border-neutral-300 text-neutral-600 bg-neutral-50",
    violet: "border-violet-300 text-violet-700 bg-violet-50",
    blue: "border-blue-300 text-blue-700 bg-blue-50",
    red: "border-red-300 text-red-700 bg-red-50",
  };
  return <span className={`text-[10px] px-1.5 py-0.5 border rounded-sm ${tones[tone]}`}>{children}</span>;
}
