import { NextRequest, NextResponse } from "next/server";
import { env } from "process";

export const dynamic = "force-dynamic";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ device_id: string; recording_id: string }> },
) {
    if (!env.SERVER_URL) {
        return NextResponse.json({ message: "SERVER_URL nao configurada no ambiente." }, { status: 500 });
    }

    const { device_id: deviceId, recording_id: recordingId } = await params;
    const response = await fetch(`${env.SERVER_URL}/devices/${deviceId}/recordings/${recordingId}/thumbnail`, {
        cache: "force-cache",
        signal: request.signal,
    });

    return new Response(response.body, {
        status: response.status,
        headers: {
            "Cache-Control": response.headers.get("cache-control") || "private, max-age=3600",
            "Content-Type": response.headers.get("content-type") || "image/jpeg",
        },
    });
}
