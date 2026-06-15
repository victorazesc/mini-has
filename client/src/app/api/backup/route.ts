import { NextRequest, NextResponse } from "next/server"
import { env } from "process"

export async function GET() {
    if (!env.SERVER_URL) {
        return NextResponse.json({ message: "SERVER_URL nao configurada no ambiente." }, { status: 500 })
    }

    try {
        const response = await fetch(`${env.SERVER_URL}/backup`, {
            method: "GET",
            cache: "no-store",
        })
        const responseText = await response.text()

        if (!response.ok) {
            return NextResponse.json(readError(responseText, "Falha ao gerar backup."), { status: response.status })
        }

        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")
        return new Response(responseText, {
            status: 200,
            headers: {
                "Content-Type": "application/json; charset=utf-8",
                "Content-Disposition": `attachment; filename="mini-has-backup-${stamp}.json"`,
                "Cache-Control": "no-store",
            },
        })
    } catch (error) {
        return NextResponse.json(
            { message: "Falha de comunicacao com o backend.", error: error instanceof Error ? error.message : "Erro desconhecido." },
            { status: 502 },
        )
    }
}

export async function POST(request: NextRequest) {
    if (!env.SERVER_URL) {
        return NextResponse.json({ message: "SERVER_URL nao configurada no ambiente." }, { status: 500 })
    }

    try {
        const body = await request.text()
        const response = await fetch(`${env.SERVER_URL}/backup/restore`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
            cache: "no-store",
        })
        const responseText = await response.text()
        const data = responseText ? JSON.parse(responseText) : null

        if (!response.ok) {
            return NextResponse.json(
                { message: data?.detail ?? data?.message ?? "Falha ao recuperar backup." },
                { status: response.status },
            )
        }

        return NextResponse.json(data)
    } catch (error) {
        return NextResponse.json(
            { message: "Falha de comunicacao com o backend.", error: error instanceof Error ? error.message : "Erro desconhecido." },
            { status: 502 },
        )
    }
}

function readError(responseText: string, fallback: string) {
    try {
        const data = responseText ? JSON.parse(responseText) : null
        return { message: data?.detail ?? data?.message ?? fallback }
    } catch {
        return { message: responseText || fallback }
    }
}
