import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CameraRecording, CommandResult, DeviceHistoryEntry, getCameraRecordings, getDevice, getDeviceHistory, getDevices, sendCommand, updateDevice, UpdateDevicePayload } from "../src/services/devices.service";
import { toast } from "sonner";

export type CommandRequest = {
    command: string | Record<string, unknown>;
    params: Record<string, unknown>;
};

export type SendCommandVariables = {
    deviceId: number;
    command: CommandRequest;
};

export function useDevices(filters?: { name?: string, type?: string }) {
    return useQuery({
        queryKey: ["devices", filters],
        queryFn: () => getDevices(filters),
        refetchInterval: 10_000,
    });
}

export function useDevice(deviceId: number) {
    return useQuery({
        queryKey: ["device", deviceId],
        queryFn: () => getDevice(deviceId),
        enabled: Number.isFinite(deviceId) && deviceId > 0,
        refetchInterval: 10_000,
        refetchOnMount: "always",
        retry: 3,
        retryDelay: (attempt) => Math.min(500 * 2 ** attempt, 3_000),
    });
}

export function useDeviceHistory(deviceId: number, limit = 40) {
    return useQuery<DeviceHistoryEntry[]>({
        queryKey: ["device-history", deviceId, limit],
        queryFn: () => getDeviceHistory(deviceId, limit),
        enabled: Number.isFinite(deviceId) && deviceId > 0,
    });
}

export function useCameraRecordings(deviceId: number, date: string) {
    return useQuery<CameraRecording[]>({
        queryKey: ["camera-recordings", deviceId, date],
        queryFn: () => getCameraRecordings(deviceId, date),
        enabled: Number.isFinite(deviceId) && deviceId > 0 && Boolean(date),
        refetchInterval: 15_000,
    });
}

export function useSendCommand() {
    const queryClient = useQueryClient();

    return useMutation<CommandResult, Error, SendCommandVariables>({

        mutationFn: ({ deviceId, command }) => {
            return sendCommand(deviceId, command.command, command.params);
        },

        onSuccess: (_data, variables) => {
            queryClient.invalidateQueries({ queryKey: ["devices"] });
            queryClient.invalidateQueries({ queryKey: ["entities"] });
            queryClient.invalidateQueries({
                queryKey: ["device", variables.deviceId],
            });
            queryClient.invalidateQueries({
                queryKey: ["device-history", variables.deviceId],
            });
        },

        onError: (error) => {
            toast.error(error.message);
        },
    });

}

export function useUpdateDevice() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ deviceId, data }: { deviceId: number; data: UpdateDevicePayload; silentSuccessToast?: boolean }) => updateDevice(deviceId, data),
        onSuccess: (_data, variables) => {
            queryClient.invalidateQueries({ queryKey: ["devices"] });
            queryClient.invalidateQueries({ queryKey: ["device", variables.deviceId] });
            queryClient.invalidateQueries({ queryKey: ["device-history", variables.deviceId] });
            if (!variables.silentSuccessToast) toast.success("Dispositivo atualizado com sucesso");
        },
        onError: (error) => {
            toast.error(error instanceof Error ? error.message : "Erro ao atualizar dispositivo");
        },
    });
}
