import { Card, CardHeader, CardFooter, CardTitle, CardDescription } from "@/components/ui/card"
import { Blinds, Brain, Camera, Lightbulb, Loader2Icon, PawPrint, Power, Wifi } from "lucide-react"
import Image from "next/image"
import { cn } from "@/lib/utils"
import { Skeleton } from "./ui/skeleton"
import { DiscoveredDevice } from "@/src/services/inbox-devices.service"
import { Button } from "./ui/button"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "./ui/select"
import { useState } from "react"
import { Room } from "@/src/services/rooms.service"
import { DEVICE_ICON_BY_TYPE } from "@/src/constants/devices_types"
import { PROVIDERS_ICON_BY_TYPE, PROVIDERS_NAME_BY_TYPE } from "@/src/constants/providers"

const CLEAR_ROOM_VALUE = "__clear_room__"

export function DiscoveredDeviceCard({ device, onAddDevice, addDeviceLoading, onIgnoreDevice, ignoreDeviceLoading, rooms }: {
    device: DiscoveredDevice,
    onAddDevice: (device: DiscoveredDevice, roomId?: number) => void,
    addDeviceLoading: boolean,
    onIgnoreDevice: (device: DiscoveredDevice) => void,
    ignoreDeviceLoading: boolean,
    rooms: Room[],
}) {
    const DeviceIcon = DEVICE_ICON_BY_TYPE[device.payload.deviceType as keyof typeof DEVICE_ICON_BY_TYPE] ?? Lightbulb
    const ProviderIcon = PROVIDERS_ICON_BY_TYPE[device.payload.provider as keyof typeof PROVIDERS_ICON_BY_TYPE] ?? "./providers/diy.svg"
    const ProviderName = PROVIDERS_NAME_BY_TYPE[device.payload.provider as keyof typeof PROVIDERS_NAME_BY_TYPE] ?? "DIY"
    const [selectedRoom, setSelectedRoom] = useState<string | undefined>(undefined)
    return (
        <Card className={cn("col-span-1")} key={device.id}>
            <CardHeader className="flex flex-row items-center gap-4">
                <div className="flex items-center justify-center rounded-full bg-secondary p-4">
                    <DeviceIcon className="size-5" />
                </div>
                <div className="flex min-w-0 flex-col gap-1">
                    <CardTitle className="flex items-center gap-2">
                        {device.payload.name}
                    </CardTitle>
                    <CardDescription className="flex items-center gap-2">
                        <div className="flex items-center gap-2">
                            <div className="flex items-center justify-center rounded-sm bg-secondary p-1">
                                <Image src={ProviderIcon} alt={ProviderName} width={24} height={24} />
                            </div>
                            <span>{ProviderName}</span>
                        </div> • <span>{device.payload.model}</span></CardDescription>
                    <CardDescription>{device.payload.status.online ? <span className="flex items-center gap-2 text-green-500"><Wifi className="size-4" /> Online</span> : <span className="flex items-center gap-2 text-red-500"><Wifi className="size-4" color="red" /> Offline</span>}</CardDescription>
                </div>
            </CardHeader>
            <CardFooter className="flex-row justify-between items-center gap-1.5 text-sm">
                <div className="flex flex-row gap-2 w-full">
                    <Select
                        id="room"
                        name="room"
                        value={selectedRoom ?? ""}
                        onValueChange={(value) => {
                            if (!value || value === CLEAR_ROOM_VALUE) {
                                setSelectedRoom(undefined)
                                return
                            }
                            setSelectedRoom(value)
                        }}
                        disabled={rooms.length === 0}
                    >
                        <SelectTrigger className="w-full">
                            <SelectValue placeholder="Comodo" />
                        </SelectTrigger>
                        <SelectContent className="w-full">
                            <SelectGroup>
                                <SelectItem value={CLEAR_ROOM_VALUE}>Sem cômodo</SelectItem>
                                {rooms.map((room) => (
                                    <SelectItem key={room.id} value={room.name}>{room.name}</SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                    <Button variant="outline" size="sm" onClick={() => onIgnoreDevice(device)} disabled={ignoreDeviceLoading}> {ignoreDeviceLoading ? <><Loader2Icon className="size-4 animate-spin" /> Ignorando...</> : "Ignorar"}</Button>
                    <Button
                        variant="default"
                        size="sm"
                        onClick={() => {
                            const selectedRoomId = rooms.find((room) => room.name === selectedRoom)?.id
                            onAddDevice(device, selectedRoomId)
                        }}
                        disabled={addDeviceLoading}
                    >
                        {addDeviceLoading ? <><Loader2Icon className="size-4 animate-spin" /> Adicionando...</> : "Adicionar"}
                    </Button>
                </div>
            </CardFooter>
        </Card>
    )
}

export function DiscoveredDeviceCardSkeleton() {
    return (
        <Skeleton className="w-full h-48" />
    )
}