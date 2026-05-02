import { NextRequest, NextResponse } from "next/server";
import { env } from "process";
import { z } from "zod";

const acceptInboxDeviceSchema = z.object({
    name: z.string().min(1, "Nome e obrigatorio"),
    roomId: z.number().min(1, "RoomId invalido").optional(),
});

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ inbox_id: string }> }
) {
    if (!env.SERVER_URL) {
        return NextResponse.json(
            { message: "SERVER_URL nao configurada no ambiente." },
            { status: 500 }
        );
    }

    const { inbox_id: inboxIdParam } = await params;
    const inbox_id = Number(inboxIdParam);

    if (!Number.isInteger(inbox_id) || inbox_id < 1) {
        return NextResponse.json(
            { message: "inbox_id invalido." },
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

    const parsed = acceptInboxDeviceSchema.safeParse(body);

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
        const response = await fetch(`${env.SERVER_URL}/inbox/devices/${inbox_id}/accept`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                name: parsed.data.name,
                ...(typeof parsed.data.roomId === "number" ? { roomId: parsed.data.roomId } : {}),
                createEntities: true,
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
                    message: data.detail ?? data.message ?? "Falha ao aceitar dispositivo na inbox.",
                },
                { status: response.status }
            );
        }

        return NextResponse.json(data, { status: 200 });
    } catch (error) {
        return NextResponse.json(
            {
                message: "Falha de comunicacao com o backend.",
                error: error instanceof Error ? error.message : "Erro desconhecido.",
            },
            { status: 502 }
        );
    }
}
