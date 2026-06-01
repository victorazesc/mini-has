export type Entity = {
    id: number;
    deviceId: number;
    uniqueKey: string;
    type: string;
    name: string;
    commandSchema: Record<string, unknown>;
    state: Record<string, unknown>;
    capabilities: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
};

export async function getEntities(): Promise<Entity[]> {
    const response = await fetch("/api/entities")

    if (!response.ok) {
        throw new Error(await errorMessageFrom(response, "Erro ao buscar entidades"))
    }

    return response.json() as Promise<Entity[]>
}

async function errorMessageFrom(response: Response, fallback: string): Promise<string> {
    try {
        const data = await response.json() as { message?: string; detail?: string; error?: string }
        return data.message ?? data.detail ?? data.error ?? fallback
    } catch {
        return fallback
    }
}