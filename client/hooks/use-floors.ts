import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
    createFloor,
    getFloorDevicePositions,
    getFloors,
    replaceFloorDevicePositions,
    updateFloor,
    uploadFloorModel,
    UpsertFloorDevicePosition,
    UpsertFloorPayload,
} from "../src/services/floors.service";
import { toast } from "sonner";

export function useFloors() {
    return useQuery({
        queryKey: ["floors"],
        queryFn: () => getFloors(),
    });
}

export function useFloorDevicePositions(floorId: number | null) {
    return useQuery({
        queryKey: ["floor-device-positions", floorId],
        queryFn: () => getFloorDevicePositions(floorId as number),
        enabled: Number.isFinite(floorId) && (floorId ?? 0) > 0,
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

export function useUploadFloorModel() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ floorId, file }: { floorId: number; file: File }) => uploadFloorModel(floorId, file),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["floors"] });
            toast.success("Modelo 3D enviado com sucesso");
        },
        onError: (error) => {
            toast.error(error instanceof Error ? error.message : "Erro ao enviar modelo 3D");
        },
    });
}

export function useReplaceFloorDevicePositions() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({
            floorId,
            positions,
        }: {
            floorId: number;
            positions: UpsertFloorDevicePosition[];
        }) => replaceFloorDevicePositions(floorId, positions),
        onSuccess: (_data, variables) => {
            queryClient.invalidateQueries({
                queryKey: ["floor-device-positions", variables.floorId],
            });
            toast.success("Posicoes salvas com sucesso");
        },
        onError: (error) => {
            toast.error(error instanceof Error ? error.message : "Erro ao salvar posicoes");
        },
    });
}
