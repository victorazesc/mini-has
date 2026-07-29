import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const serverUrl = process.env.SERVER_URL;
  if (!serverUrl) {
    return NextResponse.json({ message: "Servidor não configurado." }, { status: 500 });
  }

  try {
    const response = await fetch(`${serverUrl}/alexa/smarthome`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(request.headers.get("authorization")
          ? { Authorization: request.headers.get("authorization")! }
          : {}),
      },
      body: await request.arrayBuffer(),
      cache: "no-store",
    });
    return new NextResponse(response.body, {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("content-type") || "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json(
      { message: "Mini HAS indisponível." },
      { status: 503 },
    );
  }
}
