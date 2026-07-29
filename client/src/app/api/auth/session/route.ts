import { NextRequest, NextResponse } from "next/server";
import {
  authProxyHeaders,
  hardenAuthResponse,
} from "../proxy-utils";

export async function GET(request: NextRequest) {
  const serverUrl = process.env.SERVER_URL;
  if (!serverUrl) {
    return NextResponse.json({ message: "Servidor não configurado." }, { status: 500 });
  }

  try {
    const headers = authProxyHeaders(request);
    headers.set("Cookie", request.headers.get("cookie") || "");
    const backendResponse = await fetch(`${serverUrl}/auth/session`, {
      headers,
      cache: "no-store",
    });
    const payload = await backendResponse.json().catch(() => null);
    return hardenAuthResponse(
      NextResponse.json(payload, { status: backendResponse.status }),
    );
  } catch {
    return hardenAuthResponse(
      NextResponse.json(
        { message: "Mini HAS indisponível." },
        { status: 503 },
      ),
    );
  }
}
