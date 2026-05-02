import { NextRequest, NextResponse } from "next/server";
import { env } from "process";

export async function GET(request: NextRequest) {
    if (!env.SERVER_URL) {
        return NextResponse.json(
            { message: "SERVER_URL nao configurada no ambiente." },
            { status: 500 }
        );
    }
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const provider = searchParams.get("provider");

    const response = await fetch(`${env.SERVER_URL}/inbox/devices?status=${status}&provider=${provider}`);

    if (!response.ok) {
        return NextResponse.json(
            { message: "Erro ao buscar dispositivos." },
            { status: 500 }
        );
    }

    return NextResponse.json(await response.json());
}