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
        mutationFn: ({ entityId, name }: { entityId: number; name: string }) => updateEntity(entityId, { name }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["entities"] });
            toast.success("Canal atualizado com sucesso");
        },
        onError: (error) => {
            toast.error(error instanceof Error ? error.message : "Erro ao atualizar canal");
        },
    });
}
