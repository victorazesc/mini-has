export type Room = {
    id: number;
    name: string;
    icon?: string | null;
    description?: string | null;
    created_at: string;
    updated_at: string;
}

export type UpsertRoomPayload = {
    name: string;
    icon?: string | null;
    description?: string | null;
};

export async function getRooms(): Promise<Room[]> {
    // await new Promise(resolve => setTimeout(resolve, 10000));
    const response = await fetch(`/api/rooms`);

    if (!response.ok) {
        throw new Error("Erro ao buscar comodos");
    }

    return response.json();
}

export async function createRoom(data: UpsertRoomPayload): Promise<Room> {
    const response = await fetch(`/api/rooms`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
    });

    if (!response.ok) {
        throw new Error("Erro ao criar comodo");
    }

    return response.json();
}

export async function updateRoom(roomId: number, data: UpsertRoomPayload): Promise<Room> {
    const response = await fetch(`/api/rooms/${roomId}`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
    });

    if (!response.ok) {
        throw new Error("Erro ao atualizar comodo");
    }

    return response.json();
}