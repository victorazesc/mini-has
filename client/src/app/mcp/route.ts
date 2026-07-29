import { NextRequest, NextResponse } from "next/server";

const FORWARDED_REQUEST_HEADERS = [
  "accept",
  "authorization",
  "content-type",
  "mcp-protocol-version",
  "origin",
] as const;

export async function GET(request: NextRequest) {
  return forwardMcp(request);
}

export async function POST(request: NextRequest) {
  return forwardMcp(request, await request.arrayBuffer());
}

async function forwardMcp(request: NextRequest, body?: ArrayBuffer) {
  const serverUrl = process.env.SERVER_URL;
  if (!serverUrl) {
    return NextResponse.json({ message: "Servidor não configurado." }, { status: 500 });
  }

  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  try {
    const backendResponse = await fetch(`${serverUrl}/mcp`, {
      method: request.method,
      headers,
      body,
      cache: "no-store",
    });
    const responseHeaders = new Headers({
      "Cache-Control": "no-store",
      "Content-Type": backendResponse.headers.get("content-type") || "application/json",
    });
    for (const name of ["www-authenticate", "mcp-protocol-version"]) {
      const value = backendResponse.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    return new NextResponse(backendResponse.body, {
      status: backendResponse.status,
      headers: responseHeaders,
    });
  } catch {
    return NextResponse.json({ message: "Mini HAS indisponível." }, { status: 503 });
  }
}
