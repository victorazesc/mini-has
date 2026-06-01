export type AutomationTriggerType = "device_state_changed" | "entity_state_changed"
export type AutomationRunStatus = "pending" | "success" | "partial" | "error"

export type AutomationTrigger = {
    id: number;
    automationId: number;
    type: AutomationTriggerType;
    deviceId?: number | null;
    entityId?: number | null;
    config: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
}

export type AutomationRun = {
    id: number;
    automationId: number;
    status: AutomationRunStatus;
    summary: Record<string, unknown>;
    createdAt: string;
}

export type Automation = {
    id: number;
    name: string;
    description?: string | null;
    enabled: boolean;
    roomId?: number | null;
    roomName?: string | null;
    sceneId: number;
    sceneName?: string | null;
    trigger: AutomationTrigger;
    createdAt: string;
    updatedAt: string;
}

export type AutomationTriggerPayload = {
    type: AutomationTriggerType;
    deviceId?: number | null;
    entityId?: number | null;
    config: Record<string, unknown>;
}

export type UpsertAutomationPayload = {
    name: string;
    description?: string | null;
    enabled?: boolean;
    roomId?: number | null;
    sceneId: number;
    trigger: AutomationTriggerPayload;
}

export type PatchAutomationPayload = Partial<UpsertAutomationPayload>

export type DeleteAutomationResult = {
    deleted: boolean;
}

export async function getAutomations(): Promise<Automation[]> {
    const response = await fetch("/api/automations")

    if (!response.ok) {
        throw new Error(await errorMessageFrom(response, "Erro ao buscar automations"))
    }

    return response.json() as Promise<Automation[]>
}

export async function createAutomation(data: UpsertAutomationPayload): Promise<Automation> {
    const response = await fetch("/api/automations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
    })

    if (!response.ok) {
        throw new Error(await errorMessageFrom(response, "Erro ao criar automação"))
    }

    return response.json() as Promise<Automation>
}

export async function updateAutomation(automationId: number, data: PatchAutomationPayload): Promise<Automation> {
    const response = await fetch(`/api/automations/${automationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
    })

    if (!response.ok) {
        throw new Error(await errorMessageFrom(response, "Erro ao atualizar automação"))
    }

    return response.json() as Promise<Automation>
}

export async function deleteAutomation(automationId: number): Promise<DeleteAutomationResult> {
    const response = await fetch(`/api/automations/${automationId}`, {
        method: "DELETE",
    })

    if (!response.ok) {
        throw new Error(await errorMessageFrom(response, "Erro ao excluir automação"))
    }

    return response.json() as Promise<DeleteAutomationResult>
}

export async function getAutomationRuns(automationId: number, limit = 5): Promise<AutomationRun[]> {
    const response = await fetch(`/api/automations/${automationId}/runs?limit=${limit}`)

    if (!response.ok) {
        throw new Error(await errorMessageFrom(response, "Erro ao buscar execuções da automação"))
    }

    return response.json() as Promise<AutomationRun[]>
}

async function errorMessageFrom(response: Response, fallback: string): Promise<string> {
    try {
        const data = await response.json() as { message?: string; detail?: string; error?: string }
        return data.message ?? data.detail ?? data.error ?? fallback
    } catch {
        return fallback
    }
}