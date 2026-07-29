import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = new Set([
  "/login",
  "/api/auth/login",
  "/oauth/token",
  "/oauth/introspect",
  "/oauth/revoke",
  "/mcp",
  "/alexa/smarthome",
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-protected-resource/mcp",
  "/.well-known/oauth-authorization-server",
  "/.well-known/openid-configuration",
]);

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname);
}

function unauthorized(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/") || request.nextUrl.pathname === "/mcp") {
    return NextResponse.json({ message: "Autenticação necessária." }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set(
    "returnTo",
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );
  return NextResponse.redirect(loginUrl);
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (isPublicPath(pathname)) return NextResponse.next();

  const sessionCookieName = process.env.MINI_HAS_SESSION_COOKIE || "mini_has_session";
  if (!request.cookies.get(sessionCookieName)?.value) return unauthorized(request);

  const serverUrl = process.env.SERVER_URL;
  if (!serverUrl) {
    return NextResponse.json({ message: "Servidor não configurado." }, { status: 503 });
  }

  try {
    const sessionResponse = await fetch(`${serverUrl}/auth/session`, {
      headers: {
        Cookie: request.headers.get("cookie") || "",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
    });

    if (!sessionResponse.ok) return unauthorized(request);
    if (pathname === "/login") return NextResponse.redirect(new URL("/", request.url));
    return NextResponse.next();
  } catch {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ message: "Mini HAS indisponível." }, { status: 503 });
    }
    return unauthorized(request);
  }
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|apple-touch-icon.png|manifest.webmanifest|robots.txt|sitemap.xml).*)",
  ],
};
