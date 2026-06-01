import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
    createAutomation,
    deleteAutomation,
    getAutomationRuns,
    getAutomations,
    PatchAutomationPayload,
    updateAutomation,
    UpsertAutomationPayload,
} from "@/src/services/automations.service"

export function useAutomations() {
    return useQuery({
        queryKey: ["automations"],
        queryFn: getAutomations,
    })
}

export function useAutomationRuns(automationId: number, limit = 5) {
    return useQuery({
        queryKey: ["automation-runs", automationId, limit],
        queryFn: () => getAutomationRuns(automationId, limit),
        enabled: Number.isFinite(automationId) && automationId > 0,
    })
}

export function useCreateAutomation() {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: (data: UpsertAutomationPayload) => createAutomation(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["automations"] })
            toast.success("Automação criada com sucesso")
        },
        onError: (error) => {
            toast.error(error instanceof Error ? error.message : "Erro ao criar automação")
        },
    })
}

export function useUpdateAutomation() {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: ({ automationId, data }: { automationId: number; data: PatchAutomationPayload }) => updateAutomation(automationId, data),
        onSuccess: (_data, variables) => {
            queryClient.invalidateQueries({ queryKey: ["automations"] })
            queryClient.invalidateQueries({ queryKey: ["automation-runs", variables.automationId] })
            toast.success("Automação atualizada com sucesso")
        },
        onError: (error) => {
            toast.error(error instanceof Error ? error.message : "Erro ao atualizar automação")
        },
    })
}

export function useDeleteAutomation() {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: (automationId: number) => deleteAutomation(automationId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["automations"] })
            toast.success("Automação excluída com sucesso")
        },
        onError: (error) => {
            toast.error(error instanceof Error ? error.message : "Erro ao excluir automação")
        },
    })
}