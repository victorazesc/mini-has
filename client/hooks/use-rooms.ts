import { useQuery } from "@tanstack/react-query";
import { getRooms } from "../src/services/rooms.service";

export function useRooms() {
    return useQuery({
        queryKey: ["rooms"],
        queryFn: () => getRooms(),
    });
}