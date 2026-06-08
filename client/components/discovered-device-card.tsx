import { Card, CardHeader, CardFooter, CardTitle, CardDescription } from "@/components/ui/card"
import { CircleCheck, Lightbulb, Loader2Icon, MapPin, Network, Search, Wifi } from "lucide-react"
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
    const deviceType = device.payload.deviceType ?? "iot"
    const provider = device.payload.provider ?? device.sourceType ?? "discovery"
    const deviceName = device.payload.name ?? device.payload.manufacturer ?? device.payload.externalId ?? "Dispositivo encontrado"
    const deviceModel = device.payload.model ?? device.payload.manufacturer ?? deviceType
    const online = device.payload.status?.online
    const identification = device.payload.identification
    const DeviceIcon = DEVICE_ICON_BY_TYPE[deviceType as keyof typeof DEVICE_ICON_BY_TYPE] ?? Lightbulb
    const ProviderIcon = PROVIDERS_ICON_BY_TYPE[provider as keyof typeof PROVIDERS_ICON_BY_TYPE] ?? "./providers/diy.svg"
    const ProviderName = PROVIDERS_NAME_BY_TYPE[provider as keyof typeof PROVIDERS_NAME_BY_TYPE] ?? "DIY"
    const [selectedRoom, setSelectedRoom] = useState<string | undefined>(undefined)
    return (
        <Card className={cn("col-span-1")} key={device.id}>
            <CardHeader className="flex flex-row items-center gap-4">
                <div className="flex items-center justify-center rounded-full bg-secondary p-4">
                    <DeviceIcon className="size-5" />
                </div>
                <div className="flex min-w-0 flex-col gap-1">
                    <CardTitle className="flex items-center gap-2">
                        {deviceName}
                    </CardTitle>
                    <CardDescription className="flex items-center gap-2">
                        <div className="flex items-center gap-2">
                            <div className="flex items-center justify-center rounded-sm bg-secondary p-1">
                                <Image src={ProviderIcon} alt={ProviderName} width={24} height={24} />
                            </div>
                            <span>{ProviderName}</span>
                        </div> • <span>{deviceModel}</span></CardDescription>
                    <CardDescription>
                        {online === true ? (
                            <span className="flex items-center gap-2 text-green-500"><Wifi className="size-4" /> Online</span>
                        ) : online === false ? (
                            <span className="flex items-center gap-2 text-red-500"><Wifi className="size-4" color="red" /> Offline</span>
                        ) : (
                            <span className="flex items-center gap-2 text-muted-foreground"><Wifi className="size-4" /> Estado desconhecido</span>
                        )}
                    </CardDescription>
                    {device.sourceType === "discovery" ? (
                        <div className="mt-1 space-y-1 text-xs text-muted-foreground">
                            <p className="flex items-center gap-2">
                                <Network className="size-3.5" />
                                {[device.payload.ip, device.payload.mac].filter(Boolean).join(" • ")}
                            </p>
                            {device.payload.openPorts?.length ? (
                                <p className="flex items-center gap-2">
                                    <MapPin className="size-3.5" />
                                    Portas: {device.payload.openPorts.join(", ")}
                                </p>
                            ) : null}
                            {identification ? (
                                <p className="flex items-start gap-2">
                                    {identification.certainty === "confirmed" ? <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-green-500" /> : <Search className="mt-0.5 size-3.5 shrink-0" />}
                                    <span>
                                        <strong className="font-medium text-foreground">{identification.label}</strong>
                                        {" — "}
                                        {identification.reason}
                                        {typeof device.payload.confidence === "number" ? ` Confiança: ${Math.round(device.payload.confidence * 100)}%.` : ""}
                                    </span>
                                </p>
                            ) : null}
                        </div>
                    ) : null}
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
