"use client"
import { RoomCard } from "@/components/room-card";
import { UpsertRoomDialog } from "@/components/upsert-room-dialog";
import { Card, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useRooms } from "@/hooks/use-rooms";
import { CirclePlusIcon } from "lucide-react";

export default function RoomsPage() {
    const { data: rooms = [] } = useRooms();
    return (
        <main className="flex flex-1 flex-col px-4 lg:px-6">
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
                {rooms.map((room) => (
                    <UpsertRoomDialog key={room.id} room={room}>
                        <RoomCard room={room} />
                    </UpsertRoomDialog>
                ))}
            </div>
        </main>
    )
}