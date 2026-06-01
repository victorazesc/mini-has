"use client"
import { RoomCard } from "@/components/room-card";
import { UpsertRoomDialog } from "@/components/upsert-room-dialog";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useRooms } from "@/hooks/use-rooms";
import { CirclePlusIcon, PlusCircle } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { useFloors } from "@/hooks/use-floors";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuLabel,
    DropdownMenuItem, DropdownMenuSeparator
} from "@/components/ui/dropdown-menu";
import { useState } from "react";
import { UpsertFloorDialog } from "@/components/upsert-floor-dialog";
import Image from "next/image";
import { DynamicIcon, type IconName } from "lucide-react/dynamic";

export default function RoomsPage() {
    const [isCreateRoomOpen, setIsCreateRoomOpen] = useState(false);
    const [isCreateFloorOpen, setIsCreateFloorOpen] = useState(false);
    const { data: rooms = [] } = useRooms();
    const { data: floors = [] } = useFloors();
    // const roomsByFloor = rooms.reduce<Record<string, typeof rooms>>((acc, room) => {
    //     const floor = room.floorName?.toString().trim() || "Sem piso";
    //     acc[floor] = [...(acc[floor] ?? []), room];
    //     return acc;
    // }, {});

    return (
        <main className="bg-background">
            <section className="flex flex-1 flex-col gap-4 px-4 lg:px-6 pb-6">
                <section className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-semibold">Ambientes</h1>
                        <p className="text-sm text-muted-foreground">Ambientes da casa inteligente pisos e cômodos.</p>
                    </div>

                    <DropdownMenu>
                        <DropdownMenuTrigger nativeButton render={<Button variant="outline" />}>
                            <CirclePlusIcon className="size-4" />
                            Adicionar
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                            <DropdownMenuGroup>
                                <DropdownMenuItem onClick={() => { setIsCreateFloorOpen(true); }}>
                                    Criar novo piso
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => { setIsCreateRoomOpen(true); }}                                >
                                    Criar novo cômodo
                                </DropdownMenuItem>
                            </DropdownMenuGroup>
                        </DropdownMenuContent>
                    </DropdownMenu>


                </section>
                <Separator />
                <h1 className="text-xl font-semibold">Pisos</h1>
                <div className="@container/main grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {floors.map((floor) => (
                        <UpsertFloorDialog key={floor.id} floor={floor}>
                            <Card className="cursor-pointer hover:bg-secondary/80 transition-all duration-300 hover:shadow-lg ">
                                <CardContent className="flex flex-row items-center gap-4">
                                    <Image src={`/images/first_floor.jpg`} alt={floor.name} width={100} height={100} className="rounded-lg" />
                                    <div>
                                        <h3 className="text-base font-semibold py-4">{floor.name}</h3>
                                        <h3 className="text-base">{floor.roomsCount} cômodo{floor.roomsCount === 1 ? "" : "s"}</h3>
                                    </div>
                                </CardContent>
                            </Card>
                            {/* <FloorCard floor={floor} /> */}
                        </UpsertFloorDialog>
                    ))}
                </div>
            </section>

            <section className="flex flex-1 flex-col gap-6 px-4 lg:px-6 py-8">
                <h1 className="text-xl font-semibold">Cômodos</h1>

                <div className="@container/main grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {rooms.map((room) => (
                        <UpsertRoomDialog key={room.id} room={room}>
                            <Card className="cursor-pointer hover:bg-secondary/80 transition-all duration-300 hover:shadow-lg ">
                                <CardContent className="flex flex-row items-center gap-4">
                                    <div className="w-25 h-18 justify-center items-center flex bg-gradient-to-br from-gray-400 via-gray-300 to-gray-400 rounded-lg p-2">

                                        {room.icon && <DynamicIcon name={room.icon as IconName} className="size-12 text-secondary" />}
                                    </div>
                                    <div>
                                        <h3 className="text-base font-semibold py-4">{room.name}</h3>
                                        <h3 className="text-base">{room.devicesCount} dispositivo{room.devicesCount === 1 ? "" : "s"}</h3>
                                    </div>
                                </CardContent>
                            </Card>
                        </UpsertRoomDialog>
                    ))}
                </div>
            </section>

            <UpsertRoomDialog
                open={isCreateRoomOpen}
                onOpenChange={setIsCreateRoomOpen}
            />

            <UpsertFloorDialog
                open={isCreateFloorOpen}
                onOpenChange={setIsCreateFloorOpen}
            />
        </main>
    )
}
