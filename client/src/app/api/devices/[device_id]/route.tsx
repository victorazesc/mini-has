import { NextRequest, NextResponse } from "next/server";
import { env } from "process";

export const dynamic = "force-dynamic";

export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ device_id: string }> },
) {
    if (!env.SERVER_URL) {
        return NextResponse.json(
            { message: "SERVER_URL nao configurada no ambiente." },
            { status: 500 }
        );
    }

    const { device_id } = await params;
    try {
        const response = await fetch(`${env.SERVER_URL}/devices/${device_id}`, {
            cache: "no-store",
            headers: {
                "Content-Type": "application/json",
            },
        });
        const data = await response.json();
        return NextResponse.json(data, { status: response.status });
    } catch {
        return NextResponse.json(
            { message: "Servidor temporariamente indisponível." },
            { status: 503 },
        );
    }
}

export async function PATCH(request: NextRequest) {
    if (!env.SERVER_URL) {
        return NextResponse.json(
            { message: "SERVER_URL nao configurada no ambiente." },
            { status: 500 }
        );
    }

    const device_id = request.nextUrl.pathname.split("/").pop();
    const body = await request.json();
    const response = await fetch(`${env.SERVER_URL}/devices/${device_id}`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        return NextResponse.json(
            { message: "Erro ao atualizar dispositivo." },
            { status: response.status }
        );
    }

    return NextResponse.json(await response.json());
}
