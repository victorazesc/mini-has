import { NextResponse } from "next/server";
import { env } from "process";

export async function POST() {
    if (!env.SERVER_URL) {
        return NextResponse.json(
            { message: "SERVER_URL nao configurada no ambiente." },
            { status: 500 },
        );
    }

    const response = await fetch(`${env.SERVER_URL}/devices/refresh-network`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
    });

    const payload = await response.json().catch(() => ({ message: "Falha ao atualizar enderecos da rede." }));
    return NextResponse.json(payload, { status: response.status });
}
