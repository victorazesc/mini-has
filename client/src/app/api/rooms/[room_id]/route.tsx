import { NextRequest, NextResponse } from "next/server";
import { env } from "process";
import { z } from "zod";

const roomUpdateSchema = z.object({
    name: z.string().min(1, "Nome e obrigatorio").optional(),
    icon: z.string().nullable().optional(),
    floor: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
});

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ room_id: string }> }
) {
    if (!env.SERVER_URL) {
        return NextResponse.json(
            { message: "SERVER_URL nao configurada no ambiente." },
            { status: 500 }
        );
    }

    const { room_id: roomIdParam } = await params;
    const roomId = Number(roomIdParam);

    if (!Number.isInteger(roomId) || roomId < 1) {
        return NextResponse.json(
            { message: "room_id invalido." },
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

    const parsed = roomUpdateSchema.safeParse(body);

    if (!parsed.success) {
        return NextResponse.json(
            {
                message: "Payload invalido.",
                errors: parsed.error.flatten().fieldErrors,
            },
            { status: 400 }
        );
    }

    const response = await fetch(`${env.SERVER_URL}/rooms/${roomId}`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(parsed.data),
    });

    const data = await response.json();

    if (!response.ok) {
        return NextResponse.json(
            { message: data.detail ?? data.message ?? "Erro ao atualizar comodo." },
            { status: response.status }
        );
    }

    return NextResponse.json(data, { status: 200 });
}
