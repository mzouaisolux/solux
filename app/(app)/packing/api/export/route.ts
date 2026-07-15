// =====================================================================
// POST /packing/api/export — generate an Excel or PDF packing list from an
// engine result. Super-admin only (defense in depth beyond the page gate).
//
//   body: { format: "xlsx" | "pdf", result: PackingResult, meta: PackingMeta }
// =====================================================================
import { getCurrentUserRole } from "@/lib/auth";
import { buildPackingListExcel, type PackingMeta } from "@/lib/packing-export";
import { renderPackingPdf } from "@/components/packing/PackingListPdf";
import type { PackingResult } from "@/lib/packing-core/index.ts";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { isSuperAdmin } = await getCurrentUserRole();
  if (!isSuperAdmin) return new Response("Super-admin only", { status: 403 });

  let body: { format?: string; result?: PackingResult; meta?: PackingMeta };
  try {
    body = await req.json();
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  const { format = "xlsx", result, meta = {} } = body;
  if (!result || !Array.isArray(result.packages))
    return new Response("Missing result", { status: 400 });

  const base = `packing-list_${(meta.reference || "draft").replace(/[^\w.-]+/g, "_")}`;

  if (format === "pdf") {
    const buf = await renderPackingPdf(result, meta);
    return new Response(buf as any, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${base}.pdf"`,
      },
    });
  }

  const xls = await buildPackingListExcel(result, meta);
  return new Response(xls as any, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${base}.xlsx"`,
    },
  });
}
