import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFloor, getFloors, updateFloor, UpsertFloorPayload } from "../src/services/floors.service";
import { toast } from "sonner";

export function useFloors() {
    return useQuery({
        queryKey: ["floors"],
        queryFn: () => getFloors(),
    });
}

export function useCreateFloor() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (data: UpsertFloorPayload) => createFloor(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["floors"] });
            toast.success("Piso criado com sucesso");
        },
        onError: (error) => {
            toast.error(error instanceof Error ? error.message : "Erro ao criar piso");
        },
    });
}

export function useUpdateFloor() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ floorId, data }: { floorId: number; data: UpsertFloorPayload }) => updateFloor(floorId, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["floors"] });
            toast.success("Piso atualizado com sucesso");
        },
        onError: (error) => {
            toast.error(error instanceof Error ? error.message : "Erro ao atualizar piso");
        },
    });
}