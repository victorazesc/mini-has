import { NextRequest, NextResponse } from "next/server";
import { env } from "process";
import { z } from "zod";

const updateIntegrationSchema = z.object({
    name: z.string().min(1, "Nome e obrigatorio"),
    config: z.record(z.string(), z.unknown()).optional(),
    testOnUpdate: z.boolean().optional(),
});

export async function PATCH(
    request: NextRequest,
    context: { params: Promise<{ integration_id: string }> }
) {
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

    const parsed = updateIntegrationSchema.safeParse(body);

    if (!parsed.success) {
        return NextResponse.json(
            {
                message: "Payload invalido.",
                errors: parsed.error.flatten().fieldErrors,
            },
            { status: 400 }
        );
    }

    const { integration_id } = await context.params;

    try {
        const response = await fetch(`${env.SERVER_URL}/integrations/${integration_id}`, {
            method: "PATCH",
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
                    message: data.detail ?? data.message ?? "Falha ao atualizar integracao.",
                },
                { status: response.status }
            );
        }

        return NextResponse.json(data);
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

export async function DELETE(
    _request: NextRequest,
    context: { params: Promise<{ integration_id: string }> }
) {
    if (!env.SERVER_URL) {
        return NextResponse.json(
            { message: "SERVER_URL nao configurada no ambiente." },
            { status: 500 }
        );
    }

    const { integration_id } = await context.params;

    try {
        const response = await fetch(`${env.SERVER_URL}/integrations/${integration_id}`, {
            method: "DELETE",
        });

        const responseText = await response.text();
        const contentType = response.headers.get("content-type") ?? "";
        const isJsonResponse = contentType.includes("application/json");
        const data = responseText
            ? isJsonResponse
                ? JSON.parse(responseText)
                : { message: responseText }
            : { deleted: response.ok };

        if (!response.ok) {
            return NextResponse.json(
                {
                    message: data.detail ?? data.message ?? "Falha ao excluir integracao.",
                },
                { status: response.status }
            );
        }

        return NextResponse.json(data);
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
