import { NextRequest, NextResponse } from "next/server";
import { env } from "process";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ device_id: string; recording_id: string }> },
) {
    if (!env.SERVER_URL) {
        return NextResponse.json({ message: "SERVER_URL nao configurada no ambiente." }, { status: 500 });
    }

    const { device_id: deviceId, recording_id: recordingId } = await params;
    const range = request.headers.get("range");
    const response = await fetch(`${env.SERVER_URL}/devices/${deviceId}/recordings/${recordingId}/video`, {
        cache: "no-store",
        headers: range ? { Range: range } : {},
        signal: request.signal,
    });

    const headers = new Headers({
        "Accept-Ranges": response.headers.get("accept-ranges") || "bytes",
        "Cache-Control": "no-store",
        "Content-Type": response.headers.get("content-type") || "video/mp4",
    });
    const contentLength = response.headers.get("content-length");
    const contentRange = response.headers.get("content-range");
    if (contentLength) headers.set("Content-Length", contentLength);
    if (contentRange) headers.set("Content-Range", contentRange);

    return new Response(response.body, { status: response.status, headers });
}
