import { NextRequest, NextResponse } from "next/server"
import { env } from "process"
import { z } from "zod"

const automationTriggerSchema = z.object({
    type: z.enum(["device_state_changed", "entity_state_changed"]),
    deviceId: z.number().int().positive().nullable().optional(),
    entityId: z.number().int().positive().nullable().optional(),
    config: z.record(z.string(), z.unknown()).default({}),
}).superRefine((value, context) => {
    if (value.type === "device_state_changed" && !value.deviceId) {
        context.addIssue({ code: "custom", path: ["deviceId"], message: "Selecione um dispositivo" })
    }

    if (value.type === "entity_state_changed" && !value.entityId) {
        context.addIssue({ code: "custom", path: ["entityId"], message: "Selecione uma entidade" })
    }
})

const automationSchema = z.object({
    name: z.string().min(1, "Nome e obrigatorio"),
    description: z.string().nullable().optional(),
    enabled: z.boolean().optional(),
    roomId: z.number().int().positive().nullable().optional(),
    sceneId: z.number().int().positive("Selecione uma scene"),
    trigger: automationTriggerSchema,
})

export async function GET() {
    if (!env.SERVER_URL) {
        return NextResponse.json({ message: "SERVER_URL nao configurada no ambiente." }, { status: 500 })
    }

    try {
        const response = await fetch(`${env.SERVER_URL}/automations`, {
            headers: { "Content-Type": "application/json" },
            cache: "no-store",
        })

        const responseText = await response.text()
        const contentType = response.headers.get("content-type") ?? ""
        const data = responseText ? (contentType.includes("application/json") ? JSON.parse(responseText) : { message: responseText }) : null

        if (!response.ok) {
            return NextResponse.json(
                { message: data?.detail ?? data?.message ?? "Falha ao buscar automations." },
                { status: response.status },
            )
        }

        return NextResponse.json(data)
    } catch (error) {
        return NextResponse.json(
            { message: "Falha de comunicacao com o backend.", error: error instanceof Error ? error.message : "Erro desconhecido." },
            { status: 502 },
        )
    }
}

export async function POST(request: NextRequest) {
    if (!env.SERVER_URL) {
        return NextResponse.json({ message: "SERVER_URL nao configurada no ambiente." }, { status: 500 })
    }

    let body: unknown

    try {
        body = await request.json()
    } catch {
        return NextResponse.json({ message: "Body invalido. Envie um JSON valido." }, { status: 400 })
    }

    const parsed = automationSchema.safeParse(body)

    if (!parsed.success) {
        return NextResponse.json(
            { message: "Payload invalido.", errors: parsed.error.flatten().fieldErrors },
            { status: 400 },
        )
    }

    try {
        const response = await fetch(`${env.SERVER_URL}/automations`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(parsed.data),
        })

        const responseText = await response.text()
        const contentType = response.headers.get("content-type") ?? ""
        const data = responseText ? (contentType.includes("application/json") ? JSON.parse(responseText) : { message: responseText }) : null

        if (!response.ok) {
            return NextResponse.json(
                { message: data?.detail ?? data?.message ?? "Falha ao criar automação." },
                { status: response.status },
            )
        }

        return NextResponse.json(data, { status: 201 })
    } catch (error) {
        return NextResponse.json(
            { message: "Falha de comunicacao com o backend.", error: error instanceof Error ? error.message : "Erro desconhecido." },
            { status: 502 },
        )
    }
}