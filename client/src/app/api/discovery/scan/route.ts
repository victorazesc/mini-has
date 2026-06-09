import { NextResponse } from "next/server";
import { env } from "process";

export async function POST() {
  if (!env.SERVER_URL) {
    return NextResponse.json(
      { message: "SERVER_URL nao configurada no ambiente." },
      { status: 500 },
    );
  }

  const backendResponse = await fetch(`${env.SERVER_URL}/discovery/scan`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });
  const response = await backendResponse.json();

  return NextResponse.json(response, { status: backendResponse.status });
}
