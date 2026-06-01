import { useQuery } from "@tanstack/react-query";
import { getEntities } from "@/src/services/entities.service";

export function useEntities() {
    return useQuery({
        queryKey: ["entities"],
        queryFn: getEntities,
    });
}