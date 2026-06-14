import { NextResponse } from "next/server"
import { env } from "process"

export async function GET() {
  return proxySolar("loggers", "GET")
}

export async function POST() {
  return proxySolar("scan", "POST")
}

async function proxySolar(path: string, method: "GET" | "POST") {
  if (!env.SERVER_URL) {
    return NextResponse.json({ message: "SERVER_URL nao configurada no ambiente." }, { status: 500 })
  }

  try {
    const response = await fetch(`${env.SERVER_URL}/solar/${path}`, {
      method,
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
