"use client"
import { Button } from "@/components/ui/button";
import { useDevice, useDeviceHistory, useSendCommand } from "@/hooks/use-devices";
import { cn } from "@/lib/utils";
import { Building, Circle, Home, Power, SettingsIcon } from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { useHeaderTitle } from "@/src/providers/header-title-provider";
import { Card, CardContent } from "@/components/ui/card";
import { Device } from "@/src/services/devices.service";
import Image from "next/image";
import { PROVIDERS_ICON_BY_TYPE, PROVIDERS_NAME_BY_TYPE } from "@/src/constants/providers";
import { Badge } from "@/components/ui/badge";
import { DEVICE_TYPES_NAME_BY_TYPE, DeviceStatus } from "@/src/constants/devices_types";
import { Separator } from "@/components/ui/separator";
import { ClimateControl } from "@/components/capabilities/climate/control";
import { CoverControl } from "@/components/capabilities/cover/control";
import { DeviceHistoryCard } from "@/components/device-history-card";
import { UpsertDeviceDialog } from "@/components/upsert-device-dialog";

type SwitchChannel = {
    dpsId: string;
    label: string;
    value: boolean;
};

function getSwitchChannels(device: Device): SwitchChannel[] {
    const statusEntries = Array.isArray(device.capabilities?.status)
        ? device.capabilities.status
        : [];
    const runtimeDps = device.status?.dps ?? {};

    return statusEntries
        .filter((entry): entry is { code: string; value: boolean } => {
            if (!entry || typeof entry !== "object") {
                return false;
            }

            const candidate = entry as { code?: unknown; value?: unknown };

            return (
                typeof candidate.code === "string" &&
                candidate.code.startsWith("switch_") &&
                typeof candidate.value === "boolean"
            );
        })
        .map((entry) => {
            const dpsId = entry.code.replace("switch_", "");
            const runtimeValue = runtimeDps[dpsId];

            return {
                dpsId,
                label: `Switch ${dpsId}`,
                value: typeof runtimeValue === "boolean" ? runtimeValue : entry.value,
            };
        });
}

export default function DevicePage() {
    const { device_id } = useParams();
    const deviceId = Number(device_id);
    const { data: device } = useDevice(deviceId);
    const {
        data: history = [],
        isLoading: isLoadingHistory,
        isError: isHistoryError,
        refetch: refetchHistory,
    } = useDeviceHistory(deviceId, 40);
    const { mutate: sendCommand } = useSendCommand();
    const { setTitle, setRightAction } = useHeaderTitle();
    const queriedDeviceIdRef = useRef<number | null>(null);
    const deviceName = device?.name ?? "";
    const deviceRoomName = device?.roomName ?? "";
    const deviceOnline = device?.status?.online ?? false;

    const handleToggle = (
        deviceId: number,
        dpsId: string | number,
        currentValue: boolean

    ) => {

        sendCommand({
            deviceId,
            command: {
                command: "set",
                params: {
                    dpsId,
                    value: !currentValue,
                },
            },
        });
    };
    const handlePowerToggle = () => {
        if (!device?.id) {
            return;
        }

        const nextCommand = device.status?.state === "on" ? "turn_off" : "turn_on";
        sendCommand({
            deviceId: device.id,
            command: {
                command: nextCommand,
                params: {},
            },
        });
    };
    useEffect(() => {
        setTitle(
            <span className="flex items-center gap-2">
                {deviceOnline ?
                    <span className="flex items-center gap-2 text-green-500">
                        <Circle size={12} fill="green" />
                    </span> : <span className="flex items-center gap-2 text-red-500">
                        <Circle size={12} fill="red" />
                    </span>}
                {deviceName}
                <span className="text-muted-foreground">
                    <span className="text-muted-foreground">
                        • {deviceRoomName}
                    </span>
                </span>
            </span>);
        setRightAction(device ? (
            <UpsertDeviceDialog device={device}>
                <Button variant="secondary" size="icon" aria-label="Editar dispositivo">
                    <SettingsIcon className="size-5" />
                </Button>
            </UpsertDeviceDialog>
        ) : null);
        
        return () => {
            setTitle(null);
            setRightAction(null);
        };
    }, [device, deviceName, deviceRoomName, deviceOnline, setRightAction, setTitle]);

    useEffect(() => {
        if (!device?.id || queriedDeviceIdRef.current === device.id) {
            return;
        }

        queriedDeviceIdRef.current = device.id;
        sendCommand({
            deviceId: device.id,
            command: {
                command: "query",
                params: {},
            },
        });
    }, [device?.id, sendCommand]);

    if (!device) {
        return <div>Device not found</div>;
    }

    const switchChannels = getSwitchChannels(device);

    const ProviderIcon = PROVIDERS_ICON_BY_TYPE[device.provider as keyof typeof PROVIDERS_ICON_BY_TYPE] ?? "./providers/diy.svg"
    const ProviderName = PROVIDERS_NAME_BY_TYPE[device.provider as keyof typeof PROVIDERS_NAME_BY_TYPE] ?? "DIY"
    const DeviceTypeName = DEVICE_TYPES_NAME_BY_TYPE[device.deviceType as keyof typeof DEVICE_TYPES_NAME_BY_TYPE] ?? "Device"
    const isCover = device.deviceType === "cover";
    const isOn = isCover ? device.status.state === "open" : device.status.state === "on";
    const stateText = isCover ? coverStateText(device.status.state) : (isOn ? "Ligado" : "Desligado");
    const imageSrc = deviceImageSrc(device.deviceType);
    const lastSeenAt = device.status.lastSeenAt
        ? new Date(device.status.lastSeenAt).toLocaleString("pt-BR")
        : "Sem registro";


    return (
        <main className="flex flex-1 flex-col px-4 lg:px-6">
            <div className="@container/main flex flex-1 flex-col gap-2 space-y-4  ">
                <div className="flex flex-row gap-2 items-center px-6 bg-transparent border-none outline-none shadow-none ">
                    <div className="flex flex-row gap-2 items-center flex-2">
                        <div className="flex items-center justify-center rounded-full bg-secondary p-1">
                            <Image src={imageSrc} alt={DeviceTypeName} width={130} height={130} />
                        </div>
                        <div className="flex flex-col gap-2">
                            <h1 className="text-2xl font-semibold">{device.name}</h1>
                            <div className="flex items-center gap-2">
                                <Badge variant="outline" >
                                    {device.status.online ?
                                        <span className="flex items-center gap-2 text-green-500">
                                            <Circle size={10} fill="green" /> Online
                                        </span> : <span className="flex items-center gap-2 text-red-500">
                                            <Circle size={10} fill="red" /> Offline
                                        </span>}

                                </Badge>
                                <Badge variant="outline"><div className="flex items-center gap-2">
                                    <div className="flex items-center justify-center rounded-sm bg-secondary p-1">
                                        <Image src={ProviderIcon} alt={ProviderName} width={20} height={20} />
                                    </div>
                                    <span>{ProviderName}</span>
                                </div></Badge>
                                <Badge variant="outline">{DeviceTypeName} </Badge>
                            </div>
                            <p className="text-muted-foreground flex items-center gap-2"><Home className="size-4" /> {device.roomName}</p>
                            <p className="text-muted-foreground flex items-center gap-2"><Building className="size-4" /> {device.payload.manufacturer} • {device.payload.model}</p>
                        </div>
                    </div>
                    <Card
                        className={cn("flex-1 rounded-3xl px-6 py-5", !isCover && "cursor-pointer")}
                        onClick={isCover ? undefined : handlePowerToggle}
                    >
                        <div className="flex items-center justify-between gap-6">
                            <div className="flex flex-col gap-2">
                                <span className="text-sm font-medium text-muted-foreground">Estado</span>
                                <strong className={cn("text-2xl font-semibold", isOn ? "text-green-500" : "text-muted-foreground")}>
                                    {stateText}
                                </strong>
                                <span className={cn("flex items-center gap-2 text-sm", device.status.online ? "text-muted-foreground" : "text-red-500")}>
                                    <Circle
                                        size={10}
                                        className={cn(device.status.online ? "fill-green-500 text-green-500" : "fill-red-500 text-red-500")}
                                    />
                                    {device.status.online ? "Online" : "Offline"}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                    Último visto: {lastSeenAt}
                                </span>
                            </div>
                            <div className={cn(
                                "flex size-12 shrink-0 items-center justify-center rounded-full",
                                isOn ? "bg-green-500/20 text-green-500" : "bg-secondary text-muted-foreground"
                            )}>
                                <Power className="size-6" />
                            </div>
                        </div>
                    </Card>
                </div>

                <Separator />

                <div className="flex flex-row gap-6 w-full">
                    {switchChannels.map((channel) => (
                        <div key={channel.dpsId} className="flex flex-col gap-2 items-center">
                            <p className="text-lg font-medium text-center text-muted-foreground">{channel.label}</p>
                            <Card
                                key={channel.dpsId}
                                className="h-90 w-115 shrink-0 cursor-pointer py-0 shadow-2xl transition-transform duration-200 ease-out transform-[scale(1)] hover:transform-[scale(1.02)] active:transform-[scale(0.985)]"
                                onClick={() => handleToggle(device.id, channel.dpsId, channel.value)}
                            >
                                <CardContent className="flex flex-col h-full justify-center gap-2 px-6">
                                    <Circle className={cn("size-4", channel.value ? "fill-primary text-primary" : "fill-secondary text-secondary")} />
                                    <Circle className={cn("size-4", channel.value ? "fill-primary text-primary" : "fill-secondary text-secondary")} />
                                    <Circle className={cn("size-4", channel.value ? "fill-primary text-primary" : "fill-secondary text-secondary")} />
                                </CardContent>
                            </Card>
                        </div>
                    ))}


                    {
                        device?.deviceType === "climate" && (
                            <section className="flex-1">
                                <ClimateControl key={device.id} device={device as Device & { status: DeviceStatus }} />
                            </section>
                        )}

                    {
                        device?.deviceType === "cover" && (
                            <section className="flex-1">
                                <CoverControl key={device.id} device={device} />
                            </section>
                        )}
                </div>

                <DeviceHistoryCard
                    items={history}
                    isLoading={isLoadingHistory}
                    isError={isHistoryError}
                    onRetry={() => {
                        void refetchHistory()
                    }}
                />

            </div>
        </main>
    );
}

function deviceImageSrc(deviceType: string): string {
    if (deviceType === "camera") return "/devices/camera.jpg";
    if (deviceType === "cover") return "/devices/cover.png";
    if (["climate", "feeder", "switch", "switch2ch"].includes(deviceType)) return `/devices/${deviceType}.png`;
    return "/devices/switch.png";
}

function coverStateText(state: string): string {
    const normalized = String(state || "").toLowerCase();
    if (normalized === "open") return "Aberta";
    if (normalized === "closed") return "Fechada";
    if (normalized === "opening") return "Abrindo";
    if (normalized === "closing") return "Fechando";
    return "Parada";
}
