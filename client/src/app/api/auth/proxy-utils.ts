import { isIP } from "node:net";
import { NextRequest, NextResponse } from "next/server";

type HeadersWithSetCookie = Headers & {
  getSetCookie?: () => string[];
};

function firstHeaderValue(value: string | null): string | undefined {
  return value?.split(",")[0]?.trim() || undefined;
}

function requestIp(request: NextRequest): string | undefined {
  const candidates = [
    firstHeaderValue(request.headers.get("cf-connecting-ip")),
    firstHeaderValue(request.headers.get("x-real-ip")),
    firstHeaderValue(request.headers.get("x-forwarded-for")),
  ];
  return candidates.find((value) => value !== undefined && isIP(value) !== 0);
}

export function authProxyHeaders(request: NextRequest): Headers {
  const headers = new Headers();
  const userAgent = request.headers.get("user-agent");
  if (userAgent) headers.set("User-Agent", userAgent.slice(0, 512));

  const forwardedProtocol = firstHeaderValue(
    request.headers.get("x-forwarded-proto"),
  );
  const protocol =
    forwardedProtocol === "https" || request.nextUrl.protocol === "https:"
      ? "https"
      : "http";
  headers.set("X-Forwarded-Proto", protocol);

  const ip = requestIp(request);
  if (ip) {
    headers.set("CF-Connecting-IP", ip);
    headers.set("X-Forwarded-For", ip);
  }
  return headers;
}

export function copyAuthCookies(source: Response, target: NextResponse): void {
  const sourceHeaders = source.headers as HeadersWithSetCookie;
  const cookies = sourceHeaders.getSetCookie?.() ?? [];
  if (cookies.length > 0) {
    for (const cookie of cookies) target.headers.append("Set-Cookie", cookie);
    return;
  }

  const combined = source.headers.get("set-cookie");
  if (!combined) return;
  for (const cookie of combined.split(/,(?=\s*[^;,]+=)/)) {
    target.headers.append("Set-Cookie", cookie.trim());
  }
}

export function hardenAuthResponse(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
