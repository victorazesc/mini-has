import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getEntities, updateEntity } from "@/src/services/entities.service";
import { toast } from "sonner";

export function useEntities() {
    return useQuery({
        queryKey: ["entities"],
        queryFn: getEntities,
        refetchInterval: 10_000,
    });
}

export function useUpdateEntity() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ entityId, name, settings }: { entityId: number; name?: string; settings?: Record<string, unknown> }) => updateEntity(entityId, { name, settings }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["entities"] });
            toast.success("Sensor atualizado com sucesso");
        },
        onError: (error) => {
            toast.error(error instanceof Error ? error.message : "Erro ao atualizar sensor");
        },
    });
}
