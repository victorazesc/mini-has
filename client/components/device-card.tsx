import { Card, CardHeader, CardFooter, CardTitle, CardDescription } from "@/components/ui/card"
import { Circle, Lightbulb } from "lucide-react"
import Image from "next/image"
import { cn } from "@/lib/utils"
import { Skeleton } from "./ui/skeleton"
import { Device } from "@/src/services/devices.service"
import { DEVICE_ICON_BY_TYPE } from "@/src/constants/devices_types"
import { PROVIDERS_ICON_BY_TYPE, PROVIDERS_NAME_BY_TYPE } from "@/src/constants/providers"
import { DeviceConnectivityBadge } from "@/components/device-connectivity-badge"

export function DeviceCard({ device, isNew = false }: {
    device: Device,
    isNew?: boolean,
}) {
    const DeviceIcon = DEVICE_ICON_BY_TYPE[device.deviceType as keyof typeof DEVICE_ICON_BY_TYPE] ?? Lightbulb
    const ProviderIcon = PROVIDERS_ICON_BY_TYPE[device.provider as keyof typeof PROVIDERS_ICON_BY_TYPE] ?? "./providers/diy.svg"
    const ProviderName = PROVIDERS_NAME_BY_TYPE[device.provider as keyof typeof PROVIDERS_NAME_BY_TYPE] ?? "DIY"

    return (
        <Card className={cn("col-span-1", isNew ? "border-2 border-primary" : "")} key={device.id}>
            <CardHeader className="flex flex-row items-center gap-4">
                <div className="flex items-center justify-center rounded-full bg-secondary p-4">
                    <DeviceIcon className="size-6" />
                </div>
                <div className="flex min-w-0 flex-col gap-1">
                    <CardTitle className="flex items-center gap-2">
                        {device.status.online ?
                            <span className="flex items-center gap-2 text-green-500">
                                <Circle size={12} fill="green" />
                            </span> : <span className="flex items-center gap-2 text-red-500">
                                <Circle size={12} fill="red" />
                            </span>} {device.name}
                    </CardTitle>
                    <CardDescription className="flex items-center gap-2">
                        <span>{device.roomName}</span>
                    </CardDescription>
                </div>
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
                <DeviceConnectivityBadge device={device} />
            </CardFooter>
        </Card >
    )
}



export function DeviceCardSkeleton() {
    return (
        <Skeleton className="w-full h-48" />
    )
}
