// src/services/devices.service.ts
export type Device = {
    id: string;
    name: string;
    status: "ONLINE" | "OFFLINE";
    provider: string;
    type: string;
    room: string;
    active: boolean;
};

export async function getDevices(filters: { name?: string; type?: string } | undefined): Promise<Device[]> {
    await new Promise(resolve => setTimeout(resolve, 10000));
    const response = await fetch(`/api/devices?name=${filters?.name ?? ""}&type=${filters?.type ?? ""}`);

    if (!response.ok) {
        throw new Error("Erro ao buscar dispositivos");
    }

    return response.json();
}