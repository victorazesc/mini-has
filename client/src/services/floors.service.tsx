export type Floor = {
    id: number;
    name: string;
    description?: string | null;
    modelUrl?: string | null;
    roomsCount?: number;
    created_at: string;
    updated_at: string;
}

export type UpsertFloorPayload = {
    name: string;
    description?: string | null;
    modelUrl?: string | null;
};

export type FloorDevicePosition = {
    floorId: number;
    deviceId: number;
    entityId?: number | null;
    x: number;
    y: number;
    z: number;
    createdAt: string;
    updatedAt: string;
};

export type UpsertFloorDevicePosition = {
    deviceId: number;
    entityId?: number;
    x: number;
    y: number;
    z: number;
};

export async function getFloors(): Promise<Floor[]> {
    // await new Promise(resolve => setTimeout(resolve, 10000));
    const response = await fetch(`/api/floors`);

    if (!response.ok) {
        throw new Error("Erro ao buscar pisos");
    }

    return response.json();
}

export async function createFloor(data: UpsertFloorPayload): Promise<Floor> {
    const response = await fetch(`/api/floors`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
    });

    if (!response.ok) {
        throw new Error("Erro ao criar piso");
    }

    return response.json();
}

export async function updateFloor(floorId: number, data: UpsertFloorPayload): Promise<Floor> {
    const response = await fetch(`/api/floors/${floorId}`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
    });

    if (!response.ok) {
        throw new Error("Erro ao atualizar piso");
    }

    return response.json();
}

export async function uploadFloorModel(floorId: number, file: File): Promise<Floor> {
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(`/api/floors/${floorId}/model`, {
        method: "POST",
        body: formData,
    });

    if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.message ?? "Erro ao enviar modelo 3D");
    }

    return response.json();
}

export async function getFloorDevicePositions(floorId: number): Promise<FloorDevicePosition[]> {
    const response = await fetch(`/api/floors/${floorId}/device-positions`);

    if (!response.ok) {
        throw new Error("Erro ao buscar posicoes do piso");
    }

    return response.json();
}

export async function replaceFloorDevicePositions(
    floorId: number,
    positions: UpsertFloorDevicePosition[],
): Promise<FloorDevicePosition[]> {
    const response = await fetch(`/api/floors/${floorId}/device-positions`, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ positions }),
    });

    if (!response.ok) {
        throw new Error("Erro ao salvar posicoes do piso");
    }

    return response.json();
}
