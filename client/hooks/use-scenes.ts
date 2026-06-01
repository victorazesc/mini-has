import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { createScene, deleteScene, getSceneRuns, getScenes, runScene, SceneRun, updateScene, UpsertScenePayload } from "@/src/services/scenes.service";

export function useScenes() {
    return useQuery({
        queryKey: ["scenes"],
        queryFn: getScenes,
    });
}

export function useSceneRuns(sceneId: number, limit = 5) {
    return useQuery({
        queryKey: ["scene-runs", sceneId, limit],
        queryFn: () => getSceneRuns(sceneId, limit),
        enabled: Number.isFinite(sceneId) && sceneId > 0,
    });
}

export function useCreateScene() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (data: UpsertScenePayload) => createScene(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["scenes"] });
            toast.success("Cena criada com sucesso");
        },
        onError: (error) => {
            toast.error(error instanceof Error ? error.message : "Erro ao criar cena");
        },
    });
}

export function useUpdateScene() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ sceneId, data }: { sceneId: number; data: UpsertScenePayload }) => updateScene(sceneId, data),
        onSuccess: (_data, variables) => {
            queryClient.invalidateQueries({ queryKey: ["scenes"] });
            queryClient.invalidateQueries({ queryKey: ["scene-runs", variables.sceneId] });
            toast.success("Cena atualizada com sucesso");
        },
        onError: (error) => {
            toast.error(error instanceof Error ? error.message : "Erro ao atualizar cena");
        },
    });
}

export function useDeleteScene() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (sceneId: number) => deleteScene(sceneId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["scenes"] });
            toast.success("Cena excluida com sucesso");
        },
        onError: (error) => {
            toast.error(error instanceof Error ? error.message : "Erro ao excluir cena");
        },
    });
}

export function useRunScene() {
    const queryClient = useQueryClient();

    return useMutation<SceneRun, Error, number>({
        mutationFn: (sceneId: number) => runScene(sceneId),
        onSuccess: (data, sceneId) => {
            queryClient.invalidateQueries({ queryKey: ["scenes"] });
            queryClient.invalidateQueries({ queryKey: ["scene-runs", sceneId] });
            queryClient.invalidateQueries({ queryKey: ["devices"] });
            queryClient.invalidateQueries({ queryKey: ["device-history"] });
            toast.success(data.status === "success" ? "Cena executada com sucesso" : "Cena executada com alertas");
        },
        onError: (error) => {
            toast.error(error instanceof Error ? error.message : "Erro ao executar cena");
        },
    });
}