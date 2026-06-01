"use client"
import { RoomCard } from "@/components/room-card";
import { UpsertRoomDialog } from "@/components/upsert-room-dialog";
import { Card, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useRooms } from "@/hooks/use-rooms";
import { CirclePlusIcon } from "lucide-react";

export default function RoomsPage() {
    const { data: rooms = [] } = useRooms();
    const roomsByFloor = rooms.reduce<Record<string, typeof rooms>>((acc, room) => {
        const floor = room.floor?.trim() || "Sem piso";
        acc[floor] = [...(acc[floor] ?? []), room];
        return acc;
    }, {});

    return (
        <main className="flex flex-1 flex-col gap-6 px-4 lg:px-6">
            <div className="@container/main grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                <UpsertRoomDialog>
                    <Card className="cursor-pointer hover:bg-secondary/80 transition-all duration-300 hover:shadow-lg ">
                        <CardHeader>
                            <CardTitle className="flex items-center justify-center gap-2 py-6">
                                <CirclePlusIcon className="size-12" />
                            </CardTitle>
                        </CardHeader>
                        <CardFooter className="flex items-center justify-center ">
                            <h1 className="text-lg font-semibold">Adicionar comodo</h1>
                        </CardFooter>
                    </Card>
                </UpsertRoomDialog>
            </div>

            {Object.entries(roomsByFloor).map(([floor, floorRooms]) => (
                <section key={floor} className="flex flex-col gap-3">
                    <div>
                        <h2 className="text-lg font-semibold">{floor}</h2>
                        <p className="text-sm text-muted-foreground">{floorRooms.length} cômodo{floorRooms.length === 1 ? "" : "s"}</p>
                    </div>
                    <div className="@container/main grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {floorRooms.map((room) => (
                            <UpsertRoomDialog key={room.id} room={room}>
                                <RoomCard room={room} />
                            </UpsertRoomDialog>
                        ))}
                    </div>
                </section>
            ))}
        </main>
    )
}
