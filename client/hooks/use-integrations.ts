import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createIntegration, syncIntegration } from "../src/services/integration.service";
import { toast } from "sonner";

export function useIntegrations() {
    return useMutation({
        mutationFn: (data: { name?: string, type?: string, config?: JSON }) => createIntegration(data),
        onSuccess: () => {
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

export function useSyncIntegration() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (integration_id: number) => syncIntegration(integration_id),
        onSuccess: () => {
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