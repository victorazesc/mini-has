import { NextRequest, NextResponse } from "next/server";
import { env } from "process";
import { z } from "zod";

const commandDeviceSchema = z.object({
    command: z.string().min(1, "Comando e obrigatorio"),
    params: z.record(z.string(), z.any()).optional(),
});

export async function POST(
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
    const device_id = Number(deviceIdParam);

    if (!Number.isInteger(device_id) || device_id < 1) {
        return NextResponse.json(
            { message: "device_id invalido." },
            { status: 400 }
        );
    }

    let body: unknown;

    try {
        body = await request.json();
    } catch {
        return NextResponse.json(
            { message: "Body invalido. Envie um JSON valido." },
            { status: 400 }
        );
    }

    const parsed = commandDeviceSchema.safeParse(body);

    if (!parsed.success) {
        return NextResponse.json(
            {
                message: "Payload invalido.",
                errors: parsed.error.flatten().fieldErrors,
            },
            { status: 400 }
        );
    }

    try {
        const response = await fetch(`${env.SERVER_URL}/devices/${device_id}/command`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                command: parsed.data.command,
                params: parsed.data.params,
            }),
        });

        const responseText = await response.text();
        const contentType = response.headers.get("content-type") ?? "";
        const isJsonResponse = contentType.includes("application/json");
        const data = responseText
            ? isJsonResponse
                ? JSON.parse(responseText)
                : { message: responseText }
            : null;

        if (!response.ok) {
            return NextResponse.json(
                {
                    message: data.detail ?? data.message ?? "Falha ao enviar comando para o dispositivo.",
                },
                { status: response.status }
            );
        }

        return NextResponse.json(data, { status: 200 });
    } catch (error) {
        return NextResponse.json(
            {
                message: "Falha ao enviar comando para o dispositivo.",
                error: error instanceof Error ? error.message : "Erro desconhecido.",
            },
            { status: 502 }
        );
    }
}
