import { useQuery } from "@tanstack/react-query";
import { getDevices } from "../src/services/devices.service";

export function useDevices(filters?: { name?: string, type?: string }) {
    return useQuery({
        queryKey: ["devices", filters],
        queryFn: () => getDevices(filters),
    });
}