import { NextRequest, NextResponse } from "next/server";
import { env } from "process";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ device_id: string }> }
) {
    if (!env.SERVER_URL) {
        return NextResponse.json({ message: "SERVER_URL nao configurada no ambiente." }, { status: 500 });
    }

    const { device_id: deviceId } = await params;
    const response = await fetch(`${env.SERVER_URL}/devices/${deviceId}/stream.mjpeg`, {
        cache: "no-store",
        signal: request.signal,
    });

    return new Response(response.body, {
        status: response.status,
        headers: {
            "Cache-Control": "no-store, no-cache, must-revalidate",
            "Content-Type": response.headers.get("content-type") || "multipart/x-mixed-replace; boundary=ffmpeg",
        },
    });
}
