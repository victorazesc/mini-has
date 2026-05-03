import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createRoom, getRooms, updateRoom, UpsertRoomPayload } from "../src/services/rooms.service";
import { toast } from "sonner";

export function useRooms() {
    return useQuery({
        queryKey: ["rooms"],
        queryFn: () => getRooms(),
    });
}

export function useCreateRoom() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (data: UpsertRoomPayload) => createRoom(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["rooms"] });
            toast.success("Comodo criado com sucesso");
        },
        onError: (error) => {
            toast.error(error instanceof Error ? error.message : "Erro ao criar comodo");
        },
    });
}

export function useUpdateRoom() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ roomId, data }: { roomId: number; data: UpsertRoomPayload }) => updateRoom(roomId, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["rooms"] });
            toast.success("Comodo atualizado com sucesso");
        },
        onError: (error) => {
            toast.error(error instanceof Error ? error.message : "Erro ao atualizar comodo");
        },
    });
}