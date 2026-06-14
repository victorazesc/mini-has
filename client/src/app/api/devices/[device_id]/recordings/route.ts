import { NextRequest, NextResponse } from "next/server";
import { env } from "process";

export const dynamic = "force-dynamic";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ device_id: string }> },
) {
    if (!env.SERVER_URL) {
        return NextResponse.json({ message: "SERVER_URL nao configurada no ambiente." }, { status: 500 });
    }

    const { device_id: deviceId } = await params;
    const date = request.nextUrl.searchParams.get("date") || "";
    const response = await fetch(`${env.SERVER_URL}/devices/${deviceId}/recordings?date=${encodeURIComponent(date)}`, { cache: "no-store" });
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
}
