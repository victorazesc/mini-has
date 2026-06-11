import { readFile, stat } from "node:fs/promises";

import { NextResponse } from "next/server";

import { getSafeFloorModelPath } from "@/src/lib/floor-model-storage";

const MODEL_HEADERS = {
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
    "Content-Type": "model/gltf-binary",
};

type RouteContext = {
    params: Promise<{ file_name: string }>;
};

async function getModelFile(fileName: string) {
    const filePath = getSafeFloorModelPath(fileName);

    if (!filePath) return null;

    try {
        const fileStat = await stat(filePath);

        if (!fileStat.isFile()) return null;

        return { filePath, size: fileStat.size };
    } catch {
        return null;
    }
}

export async function HEAD(_request: Request, { params }: RouteContext) {
    const { file_name: fileName } = await params;
    const modelFile = await getModelFile(fileName);

    if (!modelFile) {
        return new NextResponse(null, { status: 404 });
    }

    return new NextResponse(null, {
        headers: {
            ...MODEL_HEADERS,
            "Content-Length": String(modelFile.size),
        },
        status: 200,
    });
}

export async function GET(_request: Request, { params }: RouteContext) {
    const { file_name: fileName } = await params;
    const modelFile = await getModelFile(fileName);

    if (!modelFile) {
        return NextResponse.json(
            { message: "Modelo 3D nao encontrado." },
            { status: 404 }
        );
    }

    const file = await readFile(modelFile.filePath);

    return new NextResponse(file, {
        headers: {
            ...MODEL_HEADERS,
            "Content-Length": String(modelFile.size),
        },
        status: 200,
    });
}
