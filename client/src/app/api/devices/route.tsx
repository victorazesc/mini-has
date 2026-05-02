import { NextRequest, NextResponse } from "next/server";
import { env } from "process";

export async function GET(request: NextRequest) {
    if (!env.SERVER_URL) {
        return NextResponse.json(
            { message: "SERVER_URL nao configurada no ambiente." },
            { status: 500 }
        );
    }

    const response = await fetch(`${env.SERVER_URL}/devices`);

    if (!response.ok) {
        return NextResponse.json(
            { message: "Erro ao buscar dispositivos." },
            { status: 500 }
        );
    }

    return NextResponse.json(await response.json());
}