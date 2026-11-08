import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/features/auth/token";

/**
 * First gate for the admin panel: no session cookie, no page. It only checks that a cookie exists. The signature, expiry and
 * the person's role are verified against the database in every page and action (see features/auth/session.ts).
 */
export function proxy(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();
  const login = new URL("/login", request.url);
  login.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(login);
}

export const config = { matcher: ["/admin/:path*"] };
