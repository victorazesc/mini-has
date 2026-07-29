import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  authProxyHeaders,
  copyAuthCookies,
  hardenAuthResponse,
} from "../proxy-utils";

const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(1024),
});

export async function POST(request: NextRequest) {
  const serverUrl = process.env.SERVER_URL;
  if (!serverUrl) {
    return NextResponse.json({ message: "Servidor não configurado." }, { status: 500 });
  }

  const parsed = loginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ message: "Email ou senha inválidos." }, { status: 400 });
  }

  try {
    const headers = authProxyHeaders(request);
    headers.set("Content-Type", "application/json");
    const backendResponse = await fetch(`${serverUrl}/auth/login`, {
      method: "POST",
      headers,
      body: JSON.stringify(parsed.data),
      cache: "no-store",
    });
    const payload = await backendResponse.json().catch(() => null);
    const response = NextResponse.json(
      backendResponse.ok ? payload : { message: "Email ou senha inválidos." },
      { status: backendResponse.status },
    );
    copyAuthCookies(backendResponse, response);
    return hardenAuthResponse(response);
  } catch {
    return hardenAuthResponse(
      NextResponse.json(
        { message: "Mini HAS indisponível no momento." },
        { status: 503 },
      ),
    );
  }
}
