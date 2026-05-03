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
        manufacturer: string;
        model: string;
        entities: Record<string, unknown>;
    };
    status: {
        online: boolean;
        state: string;
        dps: Record<string, unknown>;
        lastSeenAt: string;
    };
    capabilities: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
};

export async function getDevices(filters: { name?: string; type?: string } | undefined): Promise<Device[]> {
    // await new Promise(resolve => setTimeout(resolve, 10000));
    const response = await fetch(`/api/devices?name=${filters?.name ?? ""}&type=${filters?.type ?? ""}`);

    if (!response.ok) {
        throw new Error("Erro ao buscar dispositivos");
    }

    return response.json();
}

export async function getDevice(deviceId: number): Promise<Device> {
    const response = await fetch(`/api/devices/${deviceId}`);

    if (!response.ok) {
        throw new Error("Erro ao buscar dispositivo");
    }

    return response.json();
}

export type CommandResult = {
    ok: boolean;
    status: string;
    message: string;
    result: Record<string, unknown>;
};

export async function sendCommand(deviceId: number, command: string, params: Record<string, unknown>): Promise<CommandResult> {
    const response = await fetch(`/api/devices/${deviceId}/command`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ command, params }),
    });

    if (!response.ok) {
        throw new Error("Erro ao enviar comando");
    }

    const result = await response.json() as CommandResult;

    if (!result.ok) {
        throw new Error(result.message || "Erro ao enviar comando");
    }

    return result;
}