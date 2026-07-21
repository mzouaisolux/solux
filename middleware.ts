import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Skip: _next internals, favicon, and any top-level static asset files
  // (images, fonts, etc.) served from /public. Without this, the middleware
  // runs for /solux-logo.png and redirects unauthenticated requests to /login.
  // `mjs` matters: /pdf.worker.min.mjs (the pdf.js worker, copied to /public
  // by scripts/copy-pdf-worker.mjs) was 307-redirected to /login without it —
  // a public JS asset must not sit behind the auth wall, and a session-expired
  // race would otherwise feed pdf.js the login page HTML as its worker script.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|mjs|woff|woff2|ttf|otf|eot)).*)",
  ],
};
