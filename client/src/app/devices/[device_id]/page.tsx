"use client"
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDevice, useDeviceHistory, useSendCommand } from "@/hooks/use-devices";
import { useEntities, useUpdateEntity } from "@/hooks/use-entities";
import { cn } from "@/lib/utils";
import { AlertTriangle, Building, Camera, Circle, Home, Loader2, Power, Printer, SettingsIcon } from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useHeaderTitle } from "@/src/providers/header-title-provider";
import { Card, CardContent } from "@/components/ui/card";
import { Device } from "@/src/services/devices.service";
import Image from "next/image";
import { PROVIDERS_ICON_BY_TYPE, PROVIDERS_NAME_BY_TYPE } from "@/src/constants/providers";
import { Badge } from "@/components/ui/badge";
import { DEVICE_TYPES_NAME_BY_TYPE, DeviceStatus, deviceImageSrc } from "@/src/constants/devices_types";
import { Separator } from "@/components/ui/separator";
import { ClimateControl } from "@/components/capabilities/climate/control";
import { CoverControl } from "@/components/capabilities/cover/control";
import { DeviceHistoryCard } from "@/components/device-history-card";
import { UpsertDeviceDialog } from "@/components/upsert-device-dialog";
import { Entity } from "@/src/services/entities.service";
import { DeviceConnectivityBadge } from "@/components/device-connectivity-badge";
import { LightControl } from "@/components/capabilities/light/control";
import { AlarmControl } from "@/components/capabilities/alarm/control";
import { CameraControl } from "@/components/capabilities/camera/control";
import { FeederControl } from "@/components/capabilities/feeder/control";
import { PrinterControl } from "@/components/capabilities/printer/control";
import { Skeleton } from "@/components/ui/skeleton";

type SwitchChannel = {
    dpsId: string;
    label: string;
    value: boolean;
    entity?: Entity;
};

function getSwitchChannels(device: Device, entities: Entity[]): SwitchChannel[] {
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
            const dpsId = entry.code === "switch_led" ? "20" : entry.code.replace("switch_", "");
            const runtimeValue = runtimeDps[dpsId];

            return {
                dpsId,
                label: entities.find((entity) => String(entity.commandSchema.switchCode || "") === entry.code)?.name ?? `Switch ${dpsId}`,
                value: typeof runtimeValue === "boolean" ? runtimeValue : entry.value,
                entity: entities.find((entity) => String(entity.commandSchema.switchCode || "") === entry.code),
            };
        });
}

export default function DevicePage() {
    const { device_id } = useParams<{ device_id: string }>();
    const deviceId = Number(device_id);
    const { data: device, error: deviceError, isError: isDeviceError, isLoading: isLoadingDevice, refetch: refetchDevice } = useDevice(deviceId);
    const { data: entities = [] } = useEntities();
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
        if (!device?.id || device.deviceType.toLowerCase().includes("camera") || device.deviceType.toLowerCase() === "printer") {
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
            <span className="flex min-w-0 items-center gap-2">
                {deviceOnline ?
                    <span className="flex items-center gap-2 text-green-500">
                        <Circle size={12} fill="green" />
                    </span> : <span className="flex items-center gap-2 text-red-500">
                        <Circle size={12} fill="red" />
                    </span>}
                <span className="truncate">{deviceName}</span>
                <span className="hidden text-muted-foreground sm:inline">
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

    if (!Number.isFinite(deviceId) || deviceId < 1) {
        return <DeviceLoadError message="Dispositivo inválido." onRetry={() => window.location.reload()} />;
    }

    if (isLoadingDevice) {
        return <DevicePageSkeleton />;
    }

    if (isDeviceError) {
        return <DeviceLoadError message={deviceError.message || "Erro ao carregar dispositivo."} onRetry={() => void refetchDevice()} />;
    }

    if (!device) {
        return <DeviceLoadError message="Dispositivo não encontrado." onRetry={() => void refetchDevice()} />;
    }

    const isLight = device.deviceType.toLowerCase().includes("light") || device.deviceType.toLowerCase().includes("lamp");
    const isAlarm = device.deviceType.toLowerCase().includes("alarm") || device.deviceType.toLowerCase().includes("alarme");
    const isCamera = device.deviceType.toLowerCase().includes("camera") || device.deviceType.toLowerCase() === "cam";
    const isFeeder = device.deviceType.toLowerCase() === "feeder";
    const isPrinter = device.deviceType.toLowerCase() === "printer";
    const switchChannels = isLight || isAlarm || isCamera || isFeeder || isPrinter ? [] : getSwitchChannels(device, entities.filter((entity) => entity.deviceId === device.id));

    const ProviderIcon = PROVIDERS_ICON_BY_TYPE[device.provider as keyof typeof PROVIDERS_ICON_BY_TYPE] ?? "./providers/diy.svg"
    const ProviderName = PROVIDERS_NAME_BY_TYPE[device.provider as keyof typeof PROVIDERS_NAME_BY_TYPE] ?? "DIY"
    const DeviceTypeName = DEVICE_TYPES_NAME_BY_TYPE[device.deviceType as keyof typeof DEVICE_TYPES_NAME_BY_TYPE] ?? "Device"
    const isCover = device.deviceType === "cover";
    const isOn = isCover ? device.status.state === "open" : isAlarm ? ["armed", "partial"].includes(device.status.state) : isCamera || isPrinter ? Boolean(device.status.online) : device.status.state === "on";
    const stateText = isCover ? coverStateText(device.status.state) : isAlarm ? alarmStateText(device.status.state) : isCamera ? cameraStateText(device.status.state, device.status.online) : isPrinter ? printerStateText(device.status.state, device.status.online) : isFeeder ? feederStateText(device.status.state) : (isOn ? "Ligado" : "Desligado");
    const imageSrc = deviceImageSrc(device.deviceType);
    const lastSeenAt = device.status.lastSeenAt
        ? new Date(device.status.lastSeenAt).toLocaleString("pt-BR")
        : "Sem registro";


    return (
        <main className="flex flex-1 flex-col px-3 sm:px-4 lg:px-6">
            <div className="@container/main flex flex-1 flex-col gap-2 space-y-4  ">
                <div className="flex flex-col gap-4 bg-transparent px-0 shadow-none outline-none lg:flex-row lg:items-center lg:px-6">
                    <div className="flex flex-2 flex-col items-start gap-3 sm:flex-row sm:items-center">
                        <div className="flex size-24 shrink-0 items-center justify-center rounded-full bg-secondary p-1 sm:size-32">
                            <Image src={imageSrc} alt={DeviceTypeName} width={130} height={130} className="size-24 object-contain sm:size-[130px]" />
                        </div>
                        <div className="min-w-0 flex flex-col gap-2">
                            <h1 className="truncate text-xl font-semibold sm:text-2xl">{device.name}</h1>
                            <div className="flex flex-wrap items-center gap-2">
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
                                <DeviceConnectivityBadge device={device} />
                            </div>
                            <p className="text-muted-foreground flex items-center gap-2"><Home className="size-4" /> {device.roomName}</p>
                            <p className="flex items-center gap-2 text-sm text-muted-foreground"><Building className="size-4 shrink-0" /> <span className="truncate">{device.payload.manufacturer} • {device.payload.model}</span></p>
                        </div>
                    </div>
                    <Card
                        className={cn("w-full rounded-3xl px-5 py-4 lg:flex-1 lg:px-6 lg:py-5", !isCover && !isAlarm && !isCamera && !isFeeder && !isPrinter && "cursor-pointer")}
                        onClick={isCover || isAlarm || isCamera || isFeeder || isPrinter ? undefined : handlePowerToggle}
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
                                {isCamera ? <Camera className="size-6" /> : isPrinter ? <Printer className="size-6" /> : <Power className="size-6" />}
                            </div>
                        </div>
                    </Card>
                </div>

                <Separator />

                <div className="flex w-full flex-col gap-4 lg:flex-row lg:gap-6">
                    {switchChannels.map((channel) => (
                        <SwitchChannelCard key={channel.dpsId} channel={channel} onToggle={() => handleToggle(device.id, channel.dpsId, channel.value)} />
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
                    {isLight ? (
                        <section className="flex-1">
                            <LightControl key={device.id} device={device} />
                        </section>
                    ) : null}
                    {isAlarm ? (
                        <section className="flex-1">
                            <AlarmControl key={device.id} device={device} />
                        </section>
                    ) : null}
                    {isCamera ? (
                        <section className="flex-1">
                            <CameraControl key={device.id} device={device} />
                        </section>
                    ) : null}
                    {isFeeder ? (
                        <section className="flex-1">
                            <FeederControl key={device.id} device={device} />
                        </section>
                    ) : null}
                    {isPrinter ? (
                        <section className="flex-1">
                            <PrinterControl key={device.id} device={device} />
                        </section>
                    ) : null}
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

function DevicePageSkeleton() {
    return (
        <main className="flex flex-1 flex-col gap-6 px-4 py-4 lg:px-6">
            <div className="flex items-center gap-4">
                <Skeleton className="size-32 rounded-full" />
                <div className="space-y-3">
                    <Skeleton className="h-8 w-64" />
                    <Skeleton className="h-6 w-80" />
                    <Skeleton className="h-5 w-48" />
                </div>
            </div>
            <Skeleton className="h-72 w-full rounded-3xl" />
        </main>
    );
}

function DeviceLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
    return (
        <main className="flex flex-1 items-center justify-center p-6">
            <Card className="w-full max-w-md">
                <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
                    <AlertTriangle className="size-8 text-destructive" />
                    <div>
                        <p className="font-medium">Não foi possível carregar o dispositivo</p>
                        <p className="mt-1 text-sm text-muted-foreground">{message}</p>
                    </div>
                    <Button onClick={onRetry} variant="outline"><Loader2 className="size-4" /> Tentar novamente</Button>
                </CardContent>
            </Card>
        </main>
    );
}

function SwitchChannelCard({ channel, onToggle }: { channel: SwitchChannel; onToggle: () => void }) {
    const [name, setName] = useState(channel.label);
    const { mutate: updateEntity, isPending } = useUpdateEntity();

    useEffect(() => setName(channel.label), [channel.label]);

    return (
        <div className="flex flex-col gap-2 items-center">
            {channel.entity ? (
                <form
                    className="flex items-center gap-2"
                    onSubmit={(event) => {
                        event.preventDefault();
                        updateEntity({ entityId: channel.entity!.id, name });
                    }}
                >
                    <Input className="w-64 text-center" value={name} disabled={isPending} onChange={(event) => setName(event.target.value)} />
                    <Button type="submit" variant="outline" size="sm" disabled={isPending || !name.trim() || name.trim() === channel.label}>
                        Salvar
                    </Button>
                </form>
            ) : (
                <p className="text-lg font-medium text-center text-muted-foreground">{channel.label}</p>
            )}
            <Card
                className="h-90 w-115 shrink-0 cursor-pointer py-0 shadow-2xl transition-transform duration-200 ease-out transform-[scale(1)] hover:transform-[scale(1.02)] active:transform-[scale(0.985)]"
                onClick={onToggle}
            >
                <CardContent className="flex flex-col h-full justify-center gap-2 px-6">
                    <Circle className={cn("size-4", channel.value ? "fill-primary text-primary" : "fill-secondary text-secondary")} />
                    <Circle className={cn("size-4", channel.value ? "fill-primary text-primary" : "fill-secondary text-secondary")} />
                    <Circle className={cn("size-4", channel.value ? "fill-primary text-primary" : "fill-secondary text-secondary")} />
                </CardContent>
            </Card>
        </div>
    );
}

function coverStateText(state: string): string {
    const normalized = String(state || "").toLowerCase();
    if (normalized === "open") return "Aberta";
    if (normalized === "closed") return "Fechada";
    if (normalized === "opening") return "Abrindo";
    if (normalized === "closing") return "Fechando";
    return "Parada";
}

function alarmStateText(state: string): string {
    const normalized = String(state || "").toLowerCase();
    if (normalized === "armed") return "Armada";
    if (normalized === "partial") return "Armada parcialmente";
    if (normalized === "disarmed") return "Desarmada";
    if (normalized === "firing") return "Em disparo";
    if (normalized === "unavailable") return "Sem leitura";
    return "Estado desconhecido";
}

function cameraStateText(state: string, online: boolean): string {
    if (!online) return "Offline";
    if (String(state || "").toLowerCase() === "streaming") return "Transmitindo";
    return "Online";
}

function feederStateText(state: string): string {
    if (state === "feeding") return "Servindo";
    if (state === "done") return "Concluído";
    if (state === "standby") return "Pronto";
    return "Indisponível";
}

function printerStateText(state: string, online: boolean): string {
    if (!online) return "Offline";
    if (state === "printing") return "Imprimindo";
    if (state === "paused") return "Pausada";
    if (state === "complete") return "Concluída";
    if (state === "error") return "Erro no Klipper";
    if (state === "standby") return "Em espera";
    return "Online";
}
