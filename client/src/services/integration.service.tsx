import { Device } from "./devices.service";

export type Integration = {
    id: number;
    name: string;
    type: string;
    config: JSON;
};

export type SyncIntegrationResult = {
    ok: boolean;
    integrationId: number;
    imported: number;
    inboxIds: number[];
    inboxDevices: Device[];
    message?: string;
    details?: Record<string, unknown>;
};

export async function createIntegration(data: { name?: string; type?: string, config?: JSON } | undefined): Promise<Integration> {
    // await new Promise(resolve => setTimeout(resolve, 10000));
    const response = await fetch(`/api/integrations`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
    });

    if (!response.ok) {
        throw new Error(await response.json().then(data => data.message));
    }

    return response.json() as Promise<Integration>;
}

export async function syncIntegration(integration_id: number): Promise<SyncIntegrationResult> {
    const response = await fetch(`/api/integrations/${integration_id}/sync`, {
        method: "POST",
    });

    if (!response.ok) {
        throw new Error(await response.json().then(data => data.message));
    }

    const result = await response.json() as SyncIntegrationResult;

    if (!result.ok) {
        throw new Error(result.message ?? "Erro ao sincronizar integração");
    }

    return result;
}