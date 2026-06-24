/**
 * GET /api/documents/[id]/pdf
 *
 * On-demand "Export PDF" for a quotation. Mirrors the attachments download
 * route: verify sign-in, load the document (RLS-scoped), mint a short-lived
 * signed URL for its stored PDF (documents bucket), and redirect. A missing
 * PDF or any failure renders a clean page in the new tab instead of crashing
 * the surface the user came from.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildPdfFilename } from "@/lib/pdf-filename";

export const dynamic = "force-dynamic";

function info(message: string, status: number): NextResponse {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Quotation PDF</title></head>
<body style="margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f6f7f9;color:#1a1a1a">
  <div style="max-width:520px;margin:12vh auto;padding:28px;background:#fff;border:1px solid #e5e7eb;border-radius:14px">
    <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#9ca3af;font-weight:600">Quotation PDF</div>
    <h1 style="font-size:18px;margin:6px 0 8px">Not available</h1>
    <p style="color:#525252;line-height:1.5;margin:0">${message}</p>
    <p style="color:#9ca3af;font-size:12px;margin-top:16px">You can close this tab.</p>
  </div>
</body></html>`;
  return new NextResponse(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const id = params.id;
  if (!id) return info("No quotation was specified.", 400);

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return info("You need to be signed in to export this PDF.", 401);

  const { data: doc, error } = await supabase
    .from("documents")
    .select("pdf_url, number, type, affair_name, version, clients(company_name)")
    .eq("id", id)
    .maybeSingle();

  if (error) return info("We couldn't look up this quotation. Please try again.", 500);
  if (!doc || !doc.pdf_url) {
    return info(
      "This quotation has no generated PDF yet — open the quotation and generate it first.",
      404,
    );
  }

  const downloadName = buildPdfFilename({
    kind: ((doc as any).type as "quotation" | "proforma") ?? "quotation",
    number: (doc as any).number ?? null,
    client: (doc as any).clients?.company_name ?? null,
    affair: (doc as any).affair_name ?? null,
    version: (doc as any).version ?? null,
  });
  const { data: signed, error: signErr } = await supabase.storage
    .from("documents")
    .createSignedUrl(doc.pdf_url as string, 60 * 5, { download: downloadName });

  if (signErr || !signed?.signedUrl) {
    return info("The stored PDF couldn't be opened. Please try again.", 502);
  }

  return NextResponse.redirect(signed.signedUrl);
}
