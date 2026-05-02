import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addInboxDevice, DiscoveredDevice, getInboxDevices, ignoreInboxDevice } from "../src/services/inbox-devices.service";
import { toast } from "sonner";

export function useInboxDevices(filters?: { status?: string, provider?: string }) {
    return useQuery({
        queryKey: ["inbox-devices", filters],
        queryFn: () => getInboxDevices(filters),
    });
}

export function useAddInboxDevice() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ device, roomId }: { device: DiscoveredDevice, roomId?: number }) => addInboxDevice(device, roomId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["inbox-devices"] });
            queryClient.invalidateQueries({ queryKey: ["devices"] });
        },
        onError: () => {
            toast.error("Erro ao adicionar dispositivo na inbox");
        },
    });
}   

export function useIgnoreInboxDevice() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (device: DiscoveredDevice) => ignoreInboxDevice(device),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["inbox-devices"] });
        },
        onError: () => {
            toast.error("Erro ao ignorar dispositivo na inbox");
        },
    });
}