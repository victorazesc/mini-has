import { NextRequest, NextResponse } from "next/server";
import { env } from "process";
import { z } from "zod";

const roomSchema = z.object({
    name: z.string().min(1, "Nome e obrigatorio"),
    icon: z.string().nullable().optional(),
    floor: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
});

export async function GET() {
    if (!env.SERVER_URL) {
        return NextResponse.json(
            { message: "SERVER_URL nao configurada no ambiente." },
            { status: 500 }
        );
    }

    const response = await fetch(`${env.SERVER_URL}/rooms`);

    if (!response.ok) {
        return NextResponse.json(
            { message: "Erro ao buscar comodos." },
            { status: 500 }
        );
    }

    return NextResponse.json(await response.json());
}

export async function POST(request: NextRequest) {
    if (!env.SERVER_URL) {
        return NextResponse.json(
            { message: "SERVER_URL nao configurada no ambiente." },
            { status: 500 }
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

    const parsed = roomSchema.safeParse(body);

    if (!parsed.success) {
        return NextResponse.json(
            {
                message: "Payload invalido.",
                errors: parsed.error.flatten().fieldErrors,
            },
            { status: 400 }
        );
    }

    const response = await fetch(`${env.SERVER_URL}/rooms`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(parsed.data),
    });

    const data = await response.json();

    if (!response.ok) {
        return NextResponse.json(
            { message: data.detail ?? data.message ?? "Erro ao criar comodo." },
            { status: response.status }
        );
    }

    return NextResponse.json(data, { status: 201 });
}
