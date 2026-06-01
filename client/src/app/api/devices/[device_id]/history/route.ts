import { NextRequest, NextResponse } from "next/server";
import { env } from "process";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ device_id: string }> }
) {
    if (!env.SERVER_URL) {
        return NextResponse.json(
            { message: "SERVER_URL nao configurada no ambiente." },
            { status: 500 }
        );
    }

    const { device_id: deviceIdParam } = await params;
    const deviceId = Number(deviceIdParam);

    if (!Number.isInteger(deviceId) || deviceId < 1) {
        return NextResponse.json(
            { message: "device_id invalido." },
            { status: 400 }
        );
    }

    const limit = request.nextUrl.searchParams.get("limit") ?? "40";

    try {
        const response = await fetch(`${env.SERVER_URL}/devices/${deviceId}/history?limit=${encodeURIComponent(limit)}`, {
            headers: {
                "Content-Type": "application/json",
            },
            cache: "no-store",
        });

        const responseText = await response.text();
        const contentType = response.headers.get("content-type") ?? "";
        const isJsonResponse = contentType.includes("application/json");
        const data = responseText
            ? isJsonResponse
                ? JSON.parse(responseText)
                : { message: responseText }
            : [];

        if (!response.ok) {
            return NextResponse.json(
                {
                    message: data.detail ?? data.message ?? "Falha ao buscar histórico do dispositivo.",
                },
                { status: response.status }
            );
        }

        return NextResponse.json(data, { status: 200 });
    } catch (error) {
        return NextResponse.json(
            {
                message: "Falha ao buscar histórico do dispositivo.",
                error: error instanceof Error ? error.message : "Erro desconhecido.",
            },
            { status: 502 }
        );
    }
}