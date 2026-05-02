import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getDevices, sendCommand } from "../src/services/devices.service";
import { toast } from "sonner";

export function useDevices(filters?: { name?: string, type?: string }) {
    return useQuery({
        queryKey: ["devices", filters],
        queryFn: () => getDevices(filters),
    });
}

export function useSendCommand(deviceId: number, command: string) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: () => sendCommand(deviceId, command),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["devices"] });
        },
        onError: (error) => {
            toast.error(error.message);
        },
    });
}