import { useQuery } from "@tanstack/react-query";
import { getInboxDevices } from "../src/services/inbox-devices.service";

export function useInboxDevices(filters?: { status?: string, provider?: string }) {
    return useQuery({
        queryKey: ["inbox-devices", filters],
        queryFn: () => getInboxDevices(filters),
    });
}