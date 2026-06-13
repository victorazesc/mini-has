import { NextRequest, NextResponse } from "next/server";
import { env } from "process";

export async function PATCH(request: NextRequest) {
    if (!env.SERVER_URL) {
        return NextResponse.json({ message: "SERVER_URL nao configurada no ambiente." }, { status: 500 });
    }

    const entityId = request.nextUrl.pathname.split("/").pop();
    const response = await fetch(`${env.SERVER_URL}/entities/${entityId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(await request.json()),
    });

    const data = await response.json();
    if (!response.ok) {
        return NextResponse.json({ message: data?.detail ?? data?.message ?? "Erro ao atualizar entidade." }, { status: response.status });
    }

    return NextResponse.json(data);
}
