// src/services/inbox-devices.service.ts
import { Device } from "./devices.service";

export type DiscoveredDevice = {
    id: number;
    sourceType: string;
    sourceId: number;
    externalId: string;
    status: string;
    payload: {
        manufacturer: string;
        model: string;
        externalId: string;
        name: string;
        provider: string;
        deviceType: string;
        capabilities: {
            category: string;
            primarySwitchCode: string;
            status: { code: string; value: string }[];
        };
        status: {
            online: boolean;
            state: string;
        };
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