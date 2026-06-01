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
    roomId: number | null;
    roomName: string | null;
    payload: {
        manufacturer: string;
        model: string;
        entities: Record<string, unknown>;
    };
    status: {
        raw: unknown;
        online: boolean;
        state: string;
        dps: Record<string, unknown>;
        lastSeenAt: string;
    };
    capabilities: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
};

export type DeviceHistoryLevel = "info" | "success" | "warning" | "error";

export type DeviceHistoryEntry = {
    id: string;
    kind: "event" | "command";
    deviceId: number;
    eventType?: string | null;
    title: string;
    message?: string | null;
    status?: string | null;
    level: DeviceHistoryLevel;
    command?: Record<string, unknown> | null;
    result?: Record<string, unknown> | null;
    payload?: Record<string, unknown> | null;
    createdAt: string;
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
        throw new Error(await errorMessageFrom(response, "Erro ao buscar dispositivo"));
    }

    return response.json();
}

export async function getDeviceHistory(deviceId: number, limit = 40): Promise<DeviceHistoryEntry[]> {
    const response = await fetch(`/api/devices/${deviceId}/history?limit=${limit}`);

    if (!response.ok) {
        throw new Error(await errorMessageFrom(response, "Erro ao buscar histórico do dispositivo"));
    }

    return response.json();
}

export type UpdateDevicePayload = {
    name: string;
    deviceType: string;
    roomId: number | null;
};

export async function updateDevice(deviceId: number, data: UpdateDevicePayload): Promise<Device> {
    const response = await fetch(`/api/devices/${deviceId}`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
    });

    if (!response.ok) {
        throw new Error(await errorMessageFrom(response, "Erro ao atualizar dispositivo"));
    }

    return response.json();
}

export type CommandResult = {
    ok: boolean;
    status: string;
    message: string;
    result: Record<string, unknown>;
};

export async function sendCommand(deviceId: number, command: string | Record<string, unknown>, params: Record<string, unknown>): Promise<CommandResult> {
    const response = await fetch(`/api/devices/${deviceId}/command`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ command, params }),
    });

    if (!response.ok) {
        throw new Error(await errorMessageFrom(response, "Erro ao enviar comando"));
    }

    const result = await response.json() as CommandResult;

    if (!result.ok) {
        throw new Error(result.message || "Erro ao enviar comando");
    }

    return result;
}

async function errorMessageFrom(response: Response, fallback: string): Promise<string> {
    try {
        const data = await response.json() as { message?: string; detail?: string; error?: string };
        return data.message ?? data.detail ?? data.error ?? fallback;
    } catch {
        return fallback;
    }
}
