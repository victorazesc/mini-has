export type Room = {
    id: number;
    name: string;
    description: string;
    created_at: string;
    updated_at: string;
}

export async function getRooms(): Promise<Room[]> {
    // await new Promise(resolve => setTimeout(resolve, 10000));
    const response = await fetch(`/api/rooms`);

    if (!response.ok) {
        throw new Error("Erro ao buscar comodos");
    }

    return response.json();
}