import { NextRequest, NextResponse } from "next/server";
import { env } from "process";
import { z } from "zod";

const createIntegrationSchema = z.object({
    type: z.string().min(1, "Tipo e obrigatorio"),
    name: z.string().min(1, "Nome e obrigatorio"),
    config: z.record(z.string(), z.unknown()),
});

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

    const parsed = createIntegrationSchema.safeParse(body);

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
        const response = await fetch(`${env.SERVER_URL}/integrations`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(parsed.data),
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
                    message: data.detail ?? data.message ?? "Falha ao criar integracao.",
                },
                { status: response.status }
            );
        }

        return NextResponse.json(data, { status: 201 });
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
