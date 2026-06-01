import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createIntegration, deleteIntegration, getIntegrations, syncIntegration, updateIntegration, UpdateIntegrationPayload } from "../src/services/integration.service";
import { toast } from "sonner";

export function useIntegrations() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (data: { name?: string, type?: string, config?: JSON }) => createIntegration(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["integrations"] });
            toast.success("Integração criada com sucesso");
        },
        onError: (error) => {
            if (error instanceof Error && error.message) {
                toast.error(error.message);
                return { error: error.message };
            }

            toast.error("Erro ao criar integração");
        },
    });
}

export function useIntegrationList() {
    return useQuery({
        queryKey: ["integrations"],
        queryFn: getIntegrations,
    });
}

export function useUpdateIntegration() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ integrationId, data }: { integrationId: number; data: UpdateIntegrationPayload }) => updateIntegration(integrationId, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["integrations"] });
            toast.success("Integração atualizada com sucesso");
        },
        onError: (error) => {
            if (error instanceof Error && error.message) {
                toast.error(error.message);
                return { error: error.message };
            }

            toast.error("Erro ao atualizar integração");
        },
    });
}

export function useSyncIntegration() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (integration_id: number) => syncIntegration(integration_id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["integrations"] });
            queryClient.invalidateQueries({ queryKey: ["devices"] });
            queryClient.invalidateQueries({ queryKey: ["inbox-devices"] });
            toast.success("Integração sincronizada com sucesso");
        },
        onError: (error) => {
            if (error instanceof Error && error.message) {
                toast.error(error.message);
                return { error: error.message };
            }

            toast.error("Erro ao sincronizar integração");
        },
    });
}

export function useDeleteIntegration() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (integrationId: number) => deleteIntegration(integrationId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["integrations"] });
            queryClient.invalidateQueries({ queryKey: ["devices"] });
            toast.success("Integração excluída com sucesso");
        },
        onError: (error) => {
            if (error instanceof Error && error.message) {
                toast.error(error.message);
                return { error: error.message };
            }

            toast.error("Erro ao excluir integração");
        },
    });
}
