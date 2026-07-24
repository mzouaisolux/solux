import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
                setAll: (list: { name: string; value: string; options?: Record<string, unknown> }[]) => {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  // Token-authenticated API routes authenticate by Bearer/secret with NO user
  // session, and must return JSON — never a 302 to the HTML login page. Exempt
  // them from the session redirect (they do their own auth in-handler).
  const isTokenApi =
    pathname.startsWith("/api/specs") ||
    pathname.startsWith("/api/datasheets") ||
    pathname.startsWith("/api/hooks/") ||
    pathname.startsWith("/api/integrations/");
  const isPublic =
    pathname.startsWith("/login") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    isTokenApi;

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }
  return response;
}
