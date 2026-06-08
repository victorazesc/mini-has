// src/services/inbox-devices.service.ts
import { Device } from "./devices.service";

export type DiscoveredDevice = {
    id: number;
    sourceType: string;
    sourceId: number;
    externalId: string;
    status: string;
    payload: {
        manufacturer?: string | null;
        model?: string | null;
        externalId: string;
        name?: string | null;
        provider?: string | null;
        deviceType?: string | null;
        capabilities?: {
            category: string;
            primarySwitchCode: string;
            status: { code: string; value: string }[];
        };
        status?: {
            online: boolean;
            state: string;
        };
        ip?: string | null;
        mac?: string | null;
        hostname?: string | null;
        openPorts?: number[];
        confidence?: number;
        identification?: {
            label: string;
            reason: string;
            certainty: "confirmed" | "probable" | "limited";
        } | null;
        payload: {
            category: string;
            productName: string;
            regionKey: string;
            regionLabel: string;
            raw: Record<string, unknown>;
        };
        entities: {
            key: string;
            type: string;
            name: string;
            commandSchema: {
                commands: string[];
                switchCode: string;
            };
            state: {
                online: boolean;
                status: { code: string; value: string }[];
            };
            capabilities: {
                status: { code: string; value: string }[];
            };
        };
        matchScore: number;
        createdAt: string;
        updatedAt: string;
    };
};

export async function getInboxDevices(filters: { status?: string; provider?: string } | undefined): Promise<DiscoveredDevice[]> {
    // await new Promise(resolve => setTimeout(resolve, 10000));
    const response = await fetch(`/api/inbox/devices?status=${filters?.status ?? ""}&provider=${filters?.provider ?? ""}`);

    if (!response.ok) {
        throw new Error("Erro ao buscar dispositivos na inbox");
    }

    return response.json();
}

export async function addInboxDevice(device: DiscoveredDevice, roomId?: number): Promise<Device> {
    console.log("addInboxDevice", device, roomId);
    const response = await fetch(`/api/inbox/devices/${device.id}/accept`, {
        method: "POST",
        body: JSON.stringify({
            name: device.payload.name,
            ...(typeof roomId === "number" ? { roomId } : {}),
        }),
    });

    if (!response.ok) {
        throw new Error("Erro ao adicionar dispositivo na inbox");
    }

    return response.json();
}

export async function ignoreInboxDevice(device: DiscoveredDevice): Promise<void> {
    const response = await fetch(`/api/inbox/devices/${device.id}/ignore`, {
        method: "POST",
        body: JSON.stringify({
            reason: "Nao quero controlar agora",
        }),
    });

    if (!response.ok) {
        throw new Error("Erro ao ignorar dispositivo na inbox");
    }

    return response.json();
}
