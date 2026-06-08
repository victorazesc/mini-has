import { NextRequest, NextResponse } from "next/server";
import { env } from "process";
import { z } from "zod";

const floorUpdateSchema = z.object({
    name: z.string().min(1, "Nome e obrigatorio").optional(),
    description: z.string().nullable().optional(),
    modelUrl: z.string().nullable().optional(),
});

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ floor_id: string }> }
) {
    if (!env.SERVER_URL) {
        return NextResponse.json(
            { message: "SERVER_URL nao configurada no ambiente." },
            { status: 500 }
        );
    }

    const { floor_id: floorIdParam } = await params;
    const floorId = Number(floorIdParam);

    if (!Number.isInteger(floorId) || floorId < 1) {
        return NextResponse.json(
            { message: "floor_id invalido." },
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

    const parsed = floorUpdateSchema.safeParse(body);

    if (!parsed.success) {
        return NextResponse.json(
            {
                message: "Payload invalido.",
                errors: parsed.error.flatten().fieldErrors,
            },
            { status: 400 }
        );
    }

    const response = await fetch(`${env.SERVER_URL}/floors/${floorId}`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(parsed.data),
    });

    const data = await response.json();

    if (!response.ok) {
        return NextResponse.json(
            { message: data.detail ?? data.message ?? "Erro ao atualizar piso." },
            { status: response.status }
        );
    }

    return NextResponse.json(data, { status: 200 });
}
