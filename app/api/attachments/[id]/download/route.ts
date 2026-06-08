/**
 * GET /api/attachments/[id]/download
 *
 * On-demand file opener for project attachments. Clicking a file in the
 * AttachmentsPanel hits this route (in a new tab); it:
 *   1. verifies the user is signed in,
 *   2. loads the attachment row (RLS-scoped — the attachments read policy
 *      from m060 lets the uploader, the affair owner, AND technical roles
 *      such as task_list_manager / operations / admin read it),
 *   3. mints a SHORT-LIVED signed URL for the object,
 *   4. redirects to it.
 *
 * Why a route (instead of signing every URL at page render):
 *   - The panel used to mint signed URLs for every file inside an async
 *     server component. If one `createSignedUrl` failed (e.g. a Task List
 *     Manager opening a sales file before storage read was granted), the
 *     component threw and the whole task-list page went blank.
 *   - Here, any failure stays isolated to the new tab and renders a clean
 *     "File unavailable" page — the page the user was on never crashes.
 *   - The signed URL is always fresh (no expiry races).
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ATTACHMENTS_BUCKET } from "@/lib/attachments";

export const dynamic = "force-dynamic";

/** Small, self-contained HTML page so a failed open never shows a blank tab. */
function unavailable(message: string, status: number): NextResponse {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>File unavailable</title></head>
<body style="margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f6f7f9;color:#1a1a1a">
  <div style="max-width:520px;margin:12vh auto;padding:28px;background:#fff;border:1px solid #e5e7eb;border-radius:14px">
    <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#9ca3af;font-weight:600">Attachment</div>
    <h1 style="font-size:18px;margin:6px 0 8px">File unavailable</h1>
    <p style="color:#525252;line-height:1.5;margin:0">${message}</p>
    <p style="color:#9ca3af;font-size:12px;margin-top:16px">You can close this tab and try again.</p>
  </div>
</body></html>`;
  return new NextResponse(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const id = params.id;
  if (!id) return unavailable("No file was specified.", 400);

  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return unavailable("You need to be signed in to open this file.", 401);
  }

  // RLS decides whether this user can see the row at all. A Task List
  // Manager / operations / admin can read every affair's attachments
  // (m060), so they get the file the same as the uploader.
  const { data: row, error } = await supabase
    .from("attachments")
    .select("storage_path, file_name")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return unavailable(
      "We couldn't look up this file. Please try again.",
      500
    );
  }
  if (!row || !row.storage_path) {
    return unavailable(
      "This file is not available — it may have been removed, or you may not have access to it.",
      404
    );
  }

  // Fresh, short-lived signed URL (5 min). No `download` option, so the
  // browser displays viewable files (PDF / images / drawings) inline in
  // the new tab and downloads the rest. If storage RLS blocks the read
  // this returns an error rather than throwing — surfaced cleanly below.
  const { data: signed, error: signErr } = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .createSignedUrl(row.storage_path, 60 * 5);

  if (signErr || !signed?.signedUrl) {
    return unavailable(
      "The stored file couldn't be opened. If this keeps happening, ask an admin to verify storage access for your role.",
      502
    );
  }

  return NextResponse.redirect(signed.signedUrl);
}
