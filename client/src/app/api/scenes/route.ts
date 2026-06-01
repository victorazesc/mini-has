import { NextRequest, NextResponse } from "next/server";
import { env } from "process";
import { z } from "zod";

const sceneActionSchema = z.object({
    deviceId: z.number().int().positive(),
    orderIndex: z.number().int().positive(),
    command: z.string().min(1, "Comando e obrigatorio"),
    params: z.record(z.string(), z.unknown()).default({}),
});

const sceneSchema = z.object({
    name: z.string().min(1, "Nome e obrigatorio"),
    description: z.string().nullable().optional(),
    roomId: z.number().int().positive().nullable().optional(),
    actions: z.array(sceneActionSchema).min(1, "A cena precisa de pelo menos uma acao"),
});

export async function GET() {
    if (!env.SERVER_URL) {
        return NextResponse.json({ message: "SERVER_URL nao configurada no ambiente." }, { status: 500 });
    }

    try {
        const response = await fetch(`${env.SERVER_URL}/scenes`, {
            headers: { "Content-Type": "application/json" },
            cache: "no-store",
        });

        if (!response.ok) {
            return NextResponse.json({ message: "Erro ao buscar cenas." }, { status: response.status });
        }

        return NextResponse.json(await response.json());
    } catch (error) {
        return NextResponse.json(
            { message: "Falha de comunicacao com o backend.", error: error instanceof Error ? error.message : "Erro desconhecido." },
            { status: 502 },
        );
    }
}

export async function POST(request: NextRequest) {
    if (!env.SERVER_URL) {
        return NextResponse.json({ message: "SERVER_URL nao configurada no ambiente." }, { status: 500 });
    }

    let body: unknown;

    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ message: "Body invalido. Envie um JSON valido." }, { status: 400 });
    }

    const parsed = sceneSchema.safeParse(body);

    if (!parsed.success) {
        return NextResponse.json(
            { message: "Payload invalido.", errors: parsed.error.flatten().fieldErrors },
            { status: 400 },
        );
    }

    try {
        const response = await fetch(`${env.SERVER_URL}/scenes`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(parsed.data),
        });

        const responseText = await response.text();
        const contentType = response.headers.get("content-type") ?? "";
        const data = responseText ? (contentType.includes("application/json") ? JSON.parse(responseText) : { message: responseText }) : null;

        if (!response.ok) {
            return NextResponse.json(
                { message: data?.detail ?? data?.message ?? "Falha ao criar cena." },
                { status: response.status },
            );
        }

        return NextResponse.json(data, { status: 201 });
    } catch (error) {
        return NextResponse.json(
            { message: "Falha de comunicacao com o backend.", error: error instanceof Error ? error.message : "Erro desconhecido." },
            { status: 502 },
        );
    }
}