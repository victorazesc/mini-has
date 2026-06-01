export type SceneAction = {
    id: number;
    sceneId: number;
    deviceId: number;
    deviceName?: string | null;
    deviceType?: string | null;
    orderIndex: number;
    command: string;
    params: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
};

export type Scene = {
    id: number;
    name: string;
    description?: string | null;
    roomId?: number | null;
    roomName?: string | null;
    actions: SceneAction[];
    createdAt: string;
    updatedAt: string;
};

export type SceneRunStatus = "pending" | "success" | "partial" | "error";

export type SceneRun = {
    id: number;
    sceneId: number;
    status: SceneRunStatus;
    summary: Record<string, unknown>;
    createdAt: string;
};

export type UpsertSceneActionPayload = {
    deviceId: number;
    orderIndex: number;
    command: string;
    params: Record<string, unknown>;
};

export type UpsertScenePayload = {
    name: string;
    description?: string | null;
    roomId?: number | null;
    actions: UpsertSceneActionPayload[];
};

export type DeleteSceneResult = {
    deleted: boolean;
};

export async function getScenes(): Promise<Scene[]> {
    const response = await fetch("/api/scenes");

    if (!response.ok) {
        throw new Error(await errorMessageFrom(response, "Erro ao buscar cenas"));
    }

    return response.json() as Promise<Scene[]>;
}

export async function createScene(data: UpsertScenePayload): Promise<Scene> {
    const response = await fetch("/api/scenes", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
    });

    if (!response.ok) {
        throw new Error(await errorMessageFrom(response, "Erro ao criar cena"));
    }

    return response.json() as Promise<Scene>;
}

export async function updateScene(sceneId: number, data: UpsertScenePayload): Promise<Scene> {
    const response = await fetch(`/api/scenes/${sceneId}`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
    });

    if (!response.ok) {
        throw new Error(await errorMessageFrom(response, "Erro ao atualizar cena"));
    }

    return response.json() as Promise<Scene>;
}

export async function deleteScene(sceneId: number): Promise<DeleteSceneResult> {
    const response = await fetch(`/api/scenes/${sceneId}`, {
        method: "DELETE",
    });

    if (!response.ok) {
        throw new Error(await errorMessageFrom(response, "Erro ao excluir cena"));
    }

    return response.json() as Promise<DeleteSceneResult>;
}

export async function runScene(sceneId: number): Promise<SceneRun> {
    const response = await fetch(`/api/scenes/${sceneId}/run`, {
        method: "POST",
    });

    if (!response.ok) {
        throw new Error(await errorMessageFrom(response, "Erro ao executar cena"));
    }

    return response.json() as Promise<SceneRun>;
}

export async function getSceneRuns(sceneId: number, limit = 5): Promise<SceneRun[]> {
    const response = await fetch(`/api/scenes/${sceneId}/runs?limit=${limit}`);

    if (!response.ok) {
        throw new Error(await errorMessageFrom(response, "Erro ao buscar execucoes da cena"));
    }

    return response.json() as Promise<SceneRun[]>;
}

async function errorMessageFrom(response: Response, fallback: string): Promise<string> {
    try {
        const data = await response.json() as { message?: string; detail?: string; error?: string };
        return data.message ?? data.detail ?? data.error ?? fallback;
    } catch {
        return fallback;
    }
}