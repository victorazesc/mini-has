import { NextRequest, NextResponse } from "next/server";
import { env } from "process";

export async function POST(
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

    const backendResponse = await fetch(`${env.SERVER_URL}/integrations/${integration_id}/sync`, {
        method: "POST",
    });
    const response = await backendResponse.json();

    return NextResponse.json(response, { status: backendResponse.status });
}
