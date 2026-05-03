import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CommandResult, getDevice, getDevices, sendCommand } from "../src/services/devices.service";
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
    });
}

export function useDevice(deviceId: number) {
    return useQuery({
        queryKey: ["device", deviceId],
        queryFn: () => getDevice(deviceId),
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
            queryClient.invalidateQueries({
                queryKey: ["device", variables.deviceId],
            });
        },

        onError: (error) => {
            toast.error(error.message);
        },
    });

}