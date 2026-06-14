"use client"

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger } from "@/components/ui/select"
import { useSendCommand, useUpdateDevice } from "@/hooks/use-devices"
import { useEntities, useUpdateEntity } from "@/hooks/use-entities"
import { useRooms } from "@/hooks/use-rooms"
import { DEVICE_TYPES, DEVICE_TYPES_NAME_BY_TYPE } from "@/src/constants/devices_types"
import { Device, getDeviceConfiguration } from "@/src/services/devices.service"
import { Eye, EyeOff } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

const NO_ROOM_VALUE = "__none__";

type DeviceFormValues = {
    name: string;
    deviceType: string;
    roomId: string;
    cameraIp: string;
    cameraPort: string;
    cameraUsername: string;
    cameraPassword: string;
    cameraRtspPath: string;
};

type UpsertDeviceDialogProps = {
    device: Device;
    children: React.ReactElement;
};

type CameraValidationFeedback = {
    status: "testing" | "success" | "error";
    message: string;
};

function initialValues(device: Device): DeviceFormValues {
    const payload = device.payload as unknown as Record<string, unknown>;

    return {
        name: device.name ?? "",
        deviceType: device.deviceType ?? "",
        roomId: device.roomId ? String(device.roomId) : NO_ROOM_VALUE,
        cameraIp: stringValue(payload.ip),
        cameraPort: stringValue(device.capabilities.rtspPort) || "554",
        cameraUsername: "",
        cameraPassword: "",
        cameraRtspPath: stringValue(device.capabilities.rtspPath) || "/cam/realmonitor?channel=1&subtype=0",
    };
}

export function UpsertDeviceDialog({ device, children }: UpsertDeviceDialogProps) {
    const [open, setOpen] = useState(false);
    const [values, setValues] = useState<DeviceFormValues>(() => initialValues(device));
    const [moduleNames, setModuleNames] = useState<Record<number, string>>({});
    const [formError, setFormError] = useState<string | null>(null);
    const [isLoadingConfiguration, setIsLoadingConfiguration] = useState(false);
    const [showCameraPassword, setShowCameraPassword] = useState(false);
    const [cameraValidationFeedback, setCameraValidationFeedback] = useState<CameraValidationFeedback | null>(null);
    const { data: rooms } = useRooms();
    const { data: entities = [] } = useEntities();
    const { mutateAsync: updateDevice, isPending } = useUpdateDevice();
    const { mutateAsync: validateCamera, isPending: isValidatingCamera } = useSendCommand();
    const { mutateAsync: updateEntity, isPending: isUpdatingEntity } = useUpdateEntity();
    const camera = device.provider === "onvif_camera" || device.deviceType.toLowerCase().includes("camera");
    const solarModules = entities
        .filter((entity) => entity.deviceId === device.id && Number.isInteger(Number(entity.capabilities.module)))
        .sort((left, right) => Number(left.capabilities.module) - Number(right.capabilities.module));
    const isBusy = isPending || isUpdatingEntity || isLoadingConfiguration || isValidatingCamera;

    const deviceTypes = DEVICE_TYPES.some((item) => item.value === device.deviceType)
        ? DEVICE_TYPES
        : [
            ...DEVICE_TYPES,
            {
                label: DEVICE_TYPES_NAME_BY_TYPE[device.deviceType as keyof typeof DEVICE_TYPES_NAME_BY_TYPE] ?? device.deviceType,
                value: device.deviceType,
                icon: "brain" as const,
            },
        ];
    const selectedDeviceTypeLabel = deviceTypes.find((type) => type.value === values.deviceType)?.label || "Tipo do dispositivo";
    const selectedRoomLabel = values.roomId === NO_ROOM_VALUE
        ? "Sem cômodo"
        : rooms?.find((room) => String(room.id) === values.roomId)?.name || "Cômodo";

    const handleOpenChange = (nextOpen: boolean) => {
        if (nextOpen) {
            setValues(initialValues(device));
            setModuleNames(Object.fromEntries(solarModules.map((entity) => [entity.id, entity.name])));
            setFormError(null);
            setShowCameraPassword(false);
            setCameraValidationFeedback(null);
            if (camera) {
                setIsLoadingConfiguration(true);
                void getDeviceConfiguration(device.id)
                    .then((configuration) => {
                        const config = configuration.cameraConfig;
                        if (!config) return;
                        setValues((current) => ({
                            ...current,
                            cameraIp: config.ip,
                            cameraPort: String(config.port),
                            cameraUsername: config.username,
                            cameraPassword: config.password,
                            cameraRtspPath: config.rtspPath,
                        }));
                    })
                    .catch(() => setFormError("Não foi possível carregar as credenciais da câmera."))
                    .finally(() => setIsLoadingConfiguration(false));
            }
        }

        setOpen(nextOpen);
    };

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        const name = values.name.trim();

        if (!name) {
            setFormError("Nome e obrigatorio");
            return;
        }

        if (!values.deviceType) {
            setFormError("Tipo e obrigatorio");
            return;
        }

        setFormError(null);

        if (camera) setCameraValidationFeedback({ status: "testing", message: "Validando usuário, senha e stream RTSP..." });

        try {
            await updateDevice({
                deviceId: device.id,
                silentSuccessToast: camera,
                data: {
                    name,
                    deviceType: values.deviceType,
                    roomId: values.roomId === NO_ROOM_VALUE ? null : Number(values.roomId),
                    ...(camera ? {
                        cameraConfig: {
                            ip: values.cameraIp.trim(),
                            port: Number(values.cameraPort) || 554,
                            username: values.cameraUsername.trim(),
                            password: values.cameraPassword,
                            rtspPath: values.cameraRtspPath.trim(),
                        },
                    } : {}),
                },
            });

            if (camera) {
                const validation = await validateCamera({
                    deviceId: device.id,
                    command: { command: "query", params: {} },
                });
                const statusSummary = isRecord(validation.result.statusSummary) ? validation.result.statusSummary : {};
                const authenticated = statusSummary.authenticated === true;
                const streamAvailable = statusSummary.streamAvailable === true;
                const online = statusSummary.online === true;

                if (!authenticated || !streamAvailable) {
                    const message = !online
                        ? "A câmera não respondeu no IP e porta informados."
                        : !authenticated
                            ? "Usuário ou senha recusados pela câmera."
                            : "Credenciais aceitas, mas o caminho RTSP não respondeu.";
                    setCameraValidationFeedback({ status: "error", message });
                    toast.error(message);
                    return;
                }

                setCameraValidationFeedback({ status: "success", message: "Credenciais aceitas e stream RTSP validado." });
                toast.success("Credenciais da câmera validadas");
            }

            await Promise.all(solarModules
                .filter((entity) => moduleNames[entity.id]?.trim() && moduleNames[entity.id].trim() !== entity.name)
                .map((entity) => updateEntity({ entityId: entity.id, name: moduleNames[entity.id].trim() })));

            setOpen(false);
        } catch (error) {
            setFormError(error instanceof Error ? error.message : "Não foi possível atualizar o dispositivo.");
            if (camera) setCameraValidationFeedback({ status: "error", message: "Não foi possível validar a conexão da câmera." });
        }
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogTrigger render={children} nativeButton={true} />
            <DialogContent>
                <form onSubmit={handleSubmit}>
                    <DialogHeader>
                        <DialogTitle>Editar dispositivo</DialogTitle>
                        <DialogDescription>
                            Altere nome, tipo, cômodo e configurações específicas.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="grid gap-4 py-6">
                        <div className="grid gap-2">
                            <Label htmlFor="device-name">Nome</Label>
                            <Input
                                id="device-name"
                                value={values.name}
                                disabled={isBusy}
                                onChange={(event) => {
                                    setValues((current) => ({ ...current, name: event.target.value }));
                                    setFormError(null);
                                }}
                            />
                        </div>

                        <div className="grid gap-2">
                            <Label>Tipo</Label>
                            <Select
                                value={values.deviceType}
                                onValueChange={(value) => {
                                    setValues((current) => ({ ...current, deviceType: value || "" }));
                                    setFormError(null);
                                }}
                                disabled={isBusy}
                            >
                                <SelectTrigger className="w-full">
                                    {selectedDeviceTypeLabel}
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        {deviceTypes.map((type) => (
                                            <SelectItem key={type.value} value={type.value}>
                                                {type.label}
                                            </SelectItem>
                                        ))}
                                    </SelectGroup>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="grid gap-2">
                            <Label>Cômodo</Label>
                            <Select
                                value={values.roomId}
                                onValueChange={(value) => setValues((current) => ({ ...current, roomId: value || NO_ROOM_VALUE }))}
                                disabled={isBusy}
                            >
                                <SelectTrigger className="w-full">
                                    {selectedRoomLabel}
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        <SelectItem value={NO_ROOM_VALUE}>Sem cômodo</SelectItem>
                                        {(rooms ?? []).map((room) => (
                                            <SelectItem key={room.id} value={String(room.id)}>
                                                {room.name}
                                            </SelectItem>
                                        ))}
                                    </SelectGroup>
                                </SelectContent>
                            </Select>
                        </div>

                        {camera ? (
                            <>
                                <p className="pt-2 text-sm font-medium">Conexão da câmera</p>
                                <DeviceField id="camera-ip" label="IP" value={values.cameraIp} disabled={isBusy} onChange={(cameraIp) => {
                                    setValues((current) => ({ ...current, cameraIp }));
                                    setCameraValidationFeedback(null);
                                }} />
                                <DeviceField id="camera-port" label="Porta RTSP" value={values.cameraPort} disabled={isBusy} onChange={(cameraPort) => {
                                    setValues((current) => ({ ...current, cameraPort }));
                                    setCameraValidationFeedback(null);
                                }} />
                                <DeviceField id="camera-username" label="Usuário" value={values.cameraUsername} disabled={isBusy} onChange={(cameraUsername) => {
                                    setValues((current) => ({ ...current, cameraUsername }));
                                    setCameraValidationFeedback(null);
                                }} />
                                <div className="grid gap-2">
                                    <Label htmlFor="camera-password">Senha</Label>
                                    <div className="relative">
                                        <Input
                                            className="pr-10"
                                            id="camera-password"
                                            type={showCameraPassword ? "text" : "password"}
                                            value={values.cameraPassword}
                                            disabled={isBusy}
                                            onChange={(event) => {
                                                setValues((current) => ({ ...current, cameraPassword: event.target.value }));
                                                setCameraValidationFeedback(null);
                                            }}
                                        />
                                        <Button
                                            aria-label={showCameraPassword ? "Ocultar senha" : "Mostrar senha"}
                                            className="absolute right-1 top-1/2 size-8 -translate-y-1/2"
                                            disabled={isBusy}
                                            onClick={() => setShowCameraPassword((current) => !current)}
                                            size="icon"
                                            type="button"
                                            variant="ghost"
                                        >
                                            {showCameraPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                                        </Button>
                                    </div>
                                </div>
                                <DeviceField id="camera-rtsp-path" label="Caminho RTSP" value={values.cameraRtspPath} disabled={isBusy} onChange={(cameraRtspPath) => {
                                    setValues((current) => ({ ...current, cameraRtspPath }));
                                    setCameraValidationFeedback(null);
                                }} />
                                <p className="text-xs text-muted-foreground">Usuário e senha ficam salvos somente nesta câmera.</p>
                                {cameraValidationFeedback ? (
                                    <p className={
                                        cameraValidationFeedback.status === "error"
                                            ? "text-sm text-destructive"
                                            : cameraValidationFeedback.status === "success"
                                                ? "text-sm text-emerald-500"
                                                : "text-sm text-muted-foreground"
                                    }>
                                        {cameraValidationFeedback.message}
                                    </p>
                                ) : null}
                            </>
                        ) : null}

                        {solarModules.length ? (
                            <>
                                <p className="pt-2 text-sm font-medium">Módulos solares</p>
                                {solarModules.map((entity) => (
                                    <DeviceField
                                        id={`solar-module-${entity.id}`}
                                        key={entity.id}
                                        label={`Módulo ${String(entity.capabilities.module)}`}
                                        value={moduleNames[entity.id] ?? entity.name}
                                        disabled={isBusy}
                                        onChange={(name) => setModuleNames((current) => ({ ...current, [entity.id]: name }))}
                                    />
                                ))}
                                <p className="text-xs text-muted-foreground">As credenciais da conta Solar Send permanecem na integração.</p>
                            </>
                        ) : null}

                        {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
                    </div>

                    <DialogFooter>
                        <Button type="button" variant="outline" disabled={isBusy} onClick={() => setOpen(false)}>
                            Cancelar
                        </Button>
                        <Button type="submit" disabled={isBusy}>
                            {isValidatingCamera ? "Validando câmera..." : isBusy ? "Salvando..." : camera ? "Salvar e validar" : "Salvar"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

function DeviceField({
    id,
    label,
    value,
    disabled,
    onChange,
    type = "text",
    placeholder,
}: {
    id: string;
    label: string;
    value: string;
    disabled: boolean;
    onChange: (value: string) => void;
    type?: string;
    placeholder?: string;
}) {
    return (
        <div className="grid gap-2">
            <Label htmlFor={id}>{label}</Label>
            <Input id={id} type={type} value={value} placeholder={placeholder} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
        </div>
    );
}

function stringValue(value: unknown): string {
    return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
