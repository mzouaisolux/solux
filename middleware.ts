import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Skip: _next internals, favicon, and any top-level static asset files
  // (images, fonts, etc.) served from /public. Without this, the middleware
  // runs for /solux-logo.png and redirects unauthenticated requests to /login.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|woff|woff2|ttf|otf|eot)).*)",
  ],
};
