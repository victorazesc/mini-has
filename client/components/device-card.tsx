import { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardAction } from "@/components/ui/card"
import { Blinds, Camera, CircleCheckIcon, EllipsisVertical, Lightbulb, PawPrint, Wifi } from "lucide-react"
import Image from "next/image"
import { Switch } from "./ui/switch"
import { Badge } from "./ui/badge"
import { cn } from "@/lib/utils"
import { Skeleton } from "./ui/skeleton"
import { Device } from "@/src/services/devices.service"

const DEVICE_ICON_BY_TYPE = {
    LAMP: Lightbulb,
    CAM: Camera,
    FEEDER: PawPrint,
    CURTAIN: Blinds,
}

const PROVIDERS_ICON_BY_TYPE = {
    TUYA: "./providers/tuya.svg",
    INTELBRAS: "./providers/intelbras.svg",
    SMARTTHINGS: "./providers/smartthings.svg",
    DIY: "./providers/diy.svg",
}

const PROVIDERS_NAME_BY_TYPE = {
    TUYA: "Tuya",
    INTELBRAS: "Intelbras",
    SMARTTHINGS: "SmartThings",
    DIY: "DIY",
}

export function DeviceCard({ device, onActiveChange, isNew = false }: {
    device: Device,
    onActiveChange: (active: boolean) => void,
    isNew?: boolean,
}) {
    const DeviceIcon = DEVICE_ICON_BY_TYPE[device.deviceType as keyof typeof DEVICE_ICON_BY_TYPE] ?? Lightbulb
    const ProviderIcon = PROVIDERS_ICON_BY_TYPE[device.provider as keyof typeof PROVIDERS_ICON_BY_TYPE] ?? "./providers/diy.svg"
    const ProviderName = PROVIDERS_NAME_BY_TYPE[device.provider as keyof typeof PROVIDERS_NAME_BY_TYPE] ?? "DIY"

    return (
        <Card className={cn("col-span-1", isNew ? "border-2 border-primary" : "")} key={device.name}>
            <CardHeader className="flex flex-row items-center gap-4">
                <div className="flex items-center justify-center rounded-full bg-secondary p-4">
                    <DeviceIcon className="size-5" />
                </div>
                <div className="flex min-w-0 flex-col gap-1">
                    <CardTitle className="flex items-center gap-2">
                        <Wifi className="size-4" color={device.status.online ? "green" : "red"} />
                        {device.name}
                    </CardTitle>

                    <CardDescription>{device.roomName}</CardDescription>
                </div>
                <CardAction className="ml-auto self-start">
                    <EllipsisVertical className="size-4" />
                </CardAction>
            </CardHeader>
            <CardFooter className="flex-row justify-between items-center gap-1.5 text-sm">
                <div className="flex flex-col gap-2 font-medium pt-4">
                    <h3 className="uppercase text-xs text-muted-foreground">Provider</h3>
                    <div className="flex items-center gap-2">
                        <div className="flex items-center justify-center rounded-sm bg-secondary p-1">
                            <Image src={ProviderIcon} alt={ProviderName} width={24} height={24} />
                        </div>
                        <span>{ProviderName}</span>
                    </div>
                </div>
                <div className="flex flex-row gap-2">
                    <Switch size="xl" checked={device.status.state === "on"}
                        onCheckedChange={(active: boolean) =>
                            onActiveChange(active)} />
                </div>
            </CardFooter>
        </Card>
    )
}



export function DeviceCardSkeleton() {
    return (
        <Skeleton className="w-full h-48" />
    )
}