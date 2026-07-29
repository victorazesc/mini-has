import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  return forwardOAuthRequest(request, "introspect");
}

async function forwardOAuthRequest(request: NextRequest, path: string) {
  const serverUrl = process.env.SERVER_URL;
  if (!serverUrl) return NextResponse.json({ active: false }, { status: 500 });

  try {
    const backendResponse = await fetch(`${serverUrl}/oauth/${path}`, {
      method: "POST",
      headers: {
        "Content-Type": request.headers.get("content-type") || "application/x-www-form-urlencoded",
        ...(request.headers.get("authorization")
          ? { Authorization: request.headers.get("authorization")! }
          : {}),
      },
      body: await request.arrayBuffer(),
      cache: "no-store",
    });
    return new NextResponse(backendResponse.body, {
      status: backendResponse.status,
      headers: {
        "Content-Type": backendResponse.headers.get("content-type") || "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ active: false }, { status: 503 });
  }
}
