import { NextRequest, NextResponse } from "next/server";
import {
  authProxyHeaders,
  copyAuthCookies,
  hardenAuthResponse,
} from "../proxy-utils";

export async function POST(request: NextRequest) {
  const serverUrl = process.env.SERVER_URL;
  if (!serverUrl) {
    return NextResponse.json({ message: "Servidor não configurado." }, { status: 500 });
  }

  const csrfCookieName = process.env.MINI_HAS_CSRF_COOKIE || "mini_has_xsrf";
  const csrfToken = request.cookies.get(csrfCookieName)?.value || "";

  try {
    const headers = authProxyHeaders(request);
    headers.set("Cookie", request.headers.get("cookie") || "");
    headers.set("X-CSRF-Token", csrfToken);
    const backendResponse = await fetch(`${serverUrl}/auth/logout`, {
      method: "POST",
      headers,
      cache: "no-store",
    });
    const payload = await backendResponse.json().catch(() => ({ loggedOut: true }));
    const response = NextResponse.json(payload, { status: backendResponse.status });
    copyAuthCookies(backendResponse, response);
    return hardenAuthResponse(response);
  } catch {
    const response = NextResponse.json({ loggedOut: true });
    response.cookies.delete(process.env.MINI_HAS_SESSION_COOKIE || "mini_has_session");
    response.cookies.delete(csrfCookieName);
    return hardenAuthResponse(response);
  }
}
