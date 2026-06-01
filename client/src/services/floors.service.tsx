export type Floor = {
    id: number;
    name: string;
    description?: string | null;
    roomsCount?: number;
    created_at: string;
    updated_at: string;
}

export type UpsertFloorPayload = {
    name: string;
    description?: string | null;
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
