import { NextRequest, NextResponse } from "next/server";
import { env } from "process";

export async function POST(request: NextRequest) {
    if (!env.SERVER_URL) {
        return NextResponse.json(
            { message: "SERVER_URL nao configurada no ambiente." },
            { status: 500 }
        );
    }
    const integration_id = request.nextUrl.pathname.split("/").pop();

    const response = await fetch(`${env.SERVER_URL}/integrations/${integration_id}/sync`, {
        method: "POST",
    }).then(res => res.json());

    return NextResponse.json(response);
}