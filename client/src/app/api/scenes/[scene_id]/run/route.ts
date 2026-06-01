import { NextRequest, NextResponse } from "next/server";
import { env } from "process";

export async function POST(
    _request: NextRequest,
    context: { params: Promise<{ scene_id: string }> },
) {
    if (!env.SERVER_URL) {
        return NextResponse.json({ message: "SERVER_URL nao configurada no ambiente." }, { status: 500 });
    }

    const { scene_id } = await context.params;

    try {
        const response = await fetch(`${env.SERVER_URL}/scenes/${scene_id}/run`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
        });

        const responseText = await response.text();
        const contentType = response.headers.get("content-type") ?? "";
        const data = responseText ? (contentType.includes("application/json") ? JSON.parse(responseText) : { message: responseText }) : null;

        if (!response.ok) {
            return NextResponse.json(
                { message: data?.detail ?? data?.message ?? "Falha ao executar cena." },
                { status: response.status },
            );
        }

        return NextResponse.json(data);
    } catch (error) {
        return NextResponse.json(
            { message: "Falha de comunicacao com o backend.", error: error instanceof Error ? error.message : "Erro desconhecido." },
            { status: 502 },
        );
    }
}