import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { NextRequest, NextResponse } from "next/server";
import { env } from "process";

const MAX_MODEL_SIZE = 80 * 1024 * 1024;

function getSafeFileName(floorId: number, fileName: string) {
    const baseName = fileName
        .replace(/\.glb$/i, "")
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48) || "floor-model";

    return `floor-${floorId}-${Date.now()}-${baseName}.glb`;
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ floor_id: string }> }
) {
    if (!env.SERVER_URL) {
        return NextResponse.json(
            { message: "SERVER_URL nao configurada no ambiente." },
            { status: 500 }
        );
    }

    const { floor_id: floorIdParam } = await params;
    const floorId = Number(floorIdParam);

    if (!Number.isInteger(floorId) || floorId < 1) {
        return NextResponse.json(
            { message: "floor_id invalido." },
            { status: 400 }
        );
    }

    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
        return NextResponse.json(
            { message: "Envie um arquivo .glb." },
            { status: 400 }
        );
    }

    if (!file.name.toLowerCase().endsWith(".glb")) {
        return NextResponse.json(
            { message: "Modelo invalido. Use um arquivo .glb." },
            { status: 400 }
        );
    }

    if (file.size > MAX_MODEL_SIZE) {
        return NextResponse.json(
            { message: "Modelo muito grande. Limite de 80MB." },
            { status: 400 }
        );
    }

    const uploadDir = join(process.cwd(), "public", "uploads", "floors");
    const safeFileName = getSafeFileName(floorId, file.name);
    const modelUrl = `/uploads/floors/${safeFileName}`;

    await mkdir(uploadDir, { recursive: true });
    await writeFile(join(uploadDir, safeFileName), Buffer.from(await file.arrayBuffer()));

    const response = await fetch(`${env.SERVER_URL}/floors/${floorId}`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ modelUrl }),
    });

    const data = await response.json();

    if (!response.ok) {
        await unlink(join(uploadDir, safeFileName)).catch(() => null);

        return NextResponse.json(
            { message: data.detail ?? data.message ?? "Erro ao salvar modelo no piso." },
            { status: response.status }
        );
    }

    return NextResponse.json(data, { status: 200 });
}
