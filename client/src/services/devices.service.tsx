// src/services/devices.service.ts
export type Device = {
    id: number;
    integrationId: number;
    inbox_id: number;
    external_id: string;
    local_device_key: string;
    name: string;
    deviceType: string;
    provider: string;
    roomId: number;
    roomName: string;
    payload: {
        entities: Record<string, unknown>;
    };
    status: {
        online: boolean;
        state: string;
    };
    capabilities: Record<string, unknown>;
    created_at: string;
    updated_at: string;
};

export async function getDevices(filters: { name?: string; type?: string } | undefined): Promise<Device[]> {
    // await new Promise(resolve => setTimeout(resolve, 10000));
    const response = await fetch(`/api/devices?name=${filters?.name ?? ""}&type=${filters?.type ?? ""}`);

    if (!response.ok) {
        throw new Error("Erro ao buscar dispositivos");
    }

    return response.json();
}

export async function sendCommand(deviceId: number, command: string): Promise<void> {
    const response = await fetch(`/api/devices/${deviceId}/command`, {
        method: "POST",
        body: JSON.stringify({ command }),
    });

    if (!response.ok) {
        throw new Error("Erro ao enviar comando");
    }
}