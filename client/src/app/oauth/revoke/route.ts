import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const serverUrl = process.env.SERVER_URL;
  if (!serverUrl) return new NextResponse(null, { status: 500 });

  try {
    const backendResponse = await fetch(`${serverUrl}/oauth/revoke`, {
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
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return new NextResponse(null, { status: 503 });
  }
}
