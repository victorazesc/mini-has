import { NextRequest, NextResponse } from "next/server";
import { env } from "process";
import { z } from "zod";

const sceneActionSchema = z.object({
    deviceId: z.number().int().positive(),
    orderIndex: z.number().int().positive(),
    command: z.string().min(1).optional(),
    params: z.record(z.string(), z.unknown()).default({}),
});

const sceneUpdateSchema = z.object({
    name: z.string().min(1, "Nome e obrigatorio").optional(),
    description: z.string().nullable().optional(),
    roomId: z.number().int().positive().nullable().optional(),
    actions: z.array(sceneActionSchema.extend({ command: z.string().min(1, "Comando e obrigatorio") })).min(1).optional(),
});

export async function GET(
    _request: NextRequest,
    context: { params: Promise<{ scene_id: string }> },
) {
    if (!env.SERVER_URL) {
        return NextResponse.json({ message: "SERVER_URL nao configurada no ambiente." }, { status: 500 });
    }

    const { scene_id } = await context.params;

    try {
        const response = await fetch(`${env.SERVER_URL}/scenes/${scene_id}`, {
            headers: { "Content-Type": "application/json" },
            cache: "no-store",
        });

        const responseText = await response.text();
        const contentType = response.headers.get("content-type") ?? "";
        const data = responseText ? (contentType.includes("application/json") ? JSON.parse(responseText) : { message: responseText }) : null;

        if (!response.ok) {
            return NextResponse.json(
                { message: data?.detail ?? data?.message ?? "Falha ao buscar cena." },
                { status: response.status },
            );
        }

        return NextResponse.json(data);
    } catch (error) {
        return NextResponse.json(
            { message: "Falha de comunicacao com o backend.", error: error instanceof Error ? error.message : "Erro desconhecido." },
            { status: 502 },
        );
    }
}

export async function PATCH(
    request: NextRequest,
    context: { params: Promise<{ scene_id: string }> },
) {
    if (!env.SERVER_URL) {
        return NextResponse.json({ message: "SERVER_URL nao configurada no ambiente." }, { status: 500 });
    }

    let body: unknown;

    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ message: "Body invalido. Envie um JSON valido." }, { status: 400 });
    }

    const parsed = sceneUpdateSchema.safeParse(body);

    if (!parsed.success) {
        return NextResponse.json(
            { message: "Payload invalido.", errors: parsed.error.flatten().fieldErrors },
            { status: 400 },
        );
    }

    const { scene_id } = await context.params;

    try {
        const response = await fetch(`${env.SERVER_URL}/scenes/${scene_id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(parsed.data),
        });

        const responseText = await response.text();
        const contentType = response.headers.get("content-type") ?? "";
        const data = responseText ? (contentType.includes("application/json") ? JSON.parse(responseText) : { message: responseText }) : null;

        if (!response.ok) {
            return NextResponse.json(
                { message: data?.detail ?? data?.message ?? "Falha ao atualizar cena." },
                { status: response.status },
            );
        }

        return NextResponse.json(data);
    } catch (error) {
        return NextResponse.json(
            { message: "Falha de comunicacao com o backend.", error: error instanceof Error ? error.message : "Erro desconhecido." },
            { status: 502 },
        );
    }
}

export async function DELETE(
    _request: NextRequest,
    context: { params: Promise<{ scene_id: string }> },
) {
    if (!env.SERVER_URL) {
        return NextResponse.json({ message: "SERVER_URL nao configurada no ambiente." }, { status: 500 });
    }

    const { scene_id } = await context.params;

    try {
        const response = await fetch(`${env.SERVER_URL}/scenes/${scene_id}`, {
            method: "DELETE",
        });

        const responseText = await response.text();
        const contentType = response.headers.get("content-type") ?? "";
        const data = responseText ? (contentType.includes("application/json") ? JSON.parse(responseText) : { message: responseText }) : { deleted: response.ok };

        if (!response.ok) {
            return NextResponse.json(
                { message: data?.detail ?? data?.message ?? "Falha ao excluir cena." },
                { status: response.status },
            );
        }

        return NextResponse.json(data);
    } catch (error) {
        return NextResponse.json(
            { message: "Falha de comunicacao com o backend.", error: error instanceof Error ? error.message : "Erro desconhecido." },
            { status: 502 },
        );
    }
}