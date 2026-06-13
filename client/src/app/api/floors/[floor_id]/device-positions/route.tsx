import { NextRequest, NextResponse } from "next/server";
import { env } from "process";
import { z } from "zod";

const positionSchema = z.object({
    deviceId: z.number().int().positive(),
    entityId: z.number().int().positive().optional(),
    x: z.number().finite(),
    y: z.number().finite(),
    z: z.number().finite(),
});

const positionsSchema = z.object({
    positions: z.array(positionSchema),
});

async function getFloorId(params: Promise<{ floor_id: string }>) {
    const { floor_id: floorIdParam } = await params;
    const floorId = Number(floorIdParam);

    return Number.isInteger(floorId) && floorId > 0 ? floorId : null;
}

export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ floor_id: string }> }
) {
    if (!env.SERVER_URL) {
        return NextResponse.json(
            { message: "SERVER_URL nao configurada no ambiente." },
            { status: 500 }
        );
    }

    const floorId = await getFloorId(params);

    if (!floorId) {
        return NextResponse.json(
            { message: "floor_id invalido." },
            { status: 400 }
        );
    }

    const response = await fetch(`${env.SERVER_URL}/floors/${floorId}/device-positions`);
    const data = await response.json();

    if (!response.ok) {
        return NextResponse.json(
            { message: data.detail ?? data.message ?? "Erro ao buscar posicoes." },
            { status: response.status }
        );
    }

    return NextResponse.json(data);
}

export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ floor_id: string }> }
) {
    if (!env.SERVER_URL) {
        return NextResponse.json(
            { message: "SERVER_URL nao configurada no ambiente." },
            { status: 500 }
        );
    }

    const floorId = await getFloorId(params);

    if (!floorId) {
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

    const parsed = positionsSchema.safeParse(body);

    if (!parsed.success) {
        return NextResponse.json(
            {
                message: "Payload invalido.",
                errors: parsed.error.flatten().fieldErrors,
            },
            { status: 400 }
        );
    }

    const response = await fetch(`${env.SERVER_URL}/floors/${floorId}/device-positions`, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(parsed.data),
    });
    const data = await response.json();

    if (!response.ok) {
        return NextResponse.json(
            { message: data.detail ?? data.message ?? "Erro ao salvar posicoes." },
            { status: response.status }
        );
    }

    return NextResponse.json(data);
}
