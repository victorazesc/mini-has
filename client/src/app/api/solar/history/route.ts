import { NextRequest, NextResponse } from "next/server"
import { env } from "process"

export async function GET(request: NextRequest) {
  if (!env.SERVER_URL) {
    return NextResponse.json({ message: "SERVER_URL nao configurada no ambiente." }, { status: 500 })
  }

  const query = request.nextUrl.searchParams.toString()
  const path = query ? `history?${query}` : "history"

  try {
    const response = await fetch(`${env.SERVER_URL}/solar/${path}`, {
      method: "GET",
      cache: "no-store",
    })
    const data = await response.json()

    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    return NextResponse.json(
      { message: "Falha de comunicacao com o backend.", error: error instanceof Error ? error.message : "Erro desconhecido." },
      { status: 502 },
    )
  }
}
