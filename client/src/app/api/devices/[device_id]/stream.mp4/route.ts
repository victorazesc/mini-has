import { NextRequest, NextResponse } from "next/server";
import { env } from "process";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ device_id: string }> },
) {
    if (!env.SERVER_URL) {
        return NextResponse.json({ message: "SERVER_URL nao configurada no ambiente." }, { status: 500 });
    }

    const { device_id: deviceId } = await params;
    const quality = request.nextUrl.searchParams.get("quality");
    const serverUrl = new URL(`${env.SERVER_URL}/devices/${deviceId}/stream.mp4`);
    if (quality === "high") serverUrl.searchParams.set("quality", "high");
    const upstreamController = new AbortController();
    request.signal.addEventListener("abort", () => upstreamController.abort(), { once: true });
    const response = await fetch(serverUrl, {
        cache: "no-store",
        signal: upstreamController.signal,
    });

    return new Response(proxyStream(response.body, upstreamController), {
        status: response.status,
        headers: {
            "Cache-Control": "no-store, no-cache, must-revalidate",
            "Content-Type": response.headers.get("content-type") || "video/mp4",
        },
    });
}

function proxyStream(body: ReadableStream<Uint8Array> | null, upstreamController: AbortController) {
    if (!body) return null;
    const reader = body.getReader();
    return new ReadableStream<Uint8Array>({
        async pull(controller) {
            try {
                const result = await reader.read();
                if (result.done) {
                    controller.close();
                    upstreamController.abort();
                } else {
                    controller.enqueue(result.value);
                }
            } catch (error) {
                controller.error(error);
            }
        },
        async cancel() {
            upstreamController.abort();
            await reader.cancel();
        },
    });
}
