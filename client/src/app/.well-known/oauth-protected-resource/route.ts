import { NextResponse } from "next/server";

export async function GET() {
  return forwardMetadata("oauth-protected-resource");
}

async function forwardMetadata(path: string) {
  const serverUrl = process.env.SERVER_URL;
  if (!serverUrl) {
    return NextResponse.json({ message: "Servidor não configurado." }, { status: 500 });
  }
  try {
    const response = await fetch(`${serverUrl}/.well-known/${path}`, {
      cache: "no-store",
    });
    return new NextResponse(response.body, {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("content-type") || "application/json",
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch {
    return NextResponse.json({ message: "Mini HAS indisponível." }, { status: 503 });
  }
}
