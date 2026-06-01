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
import { useUpdateDevice } from "@/hooks/use-devices"
import { useRooms } from "@/hooks/use-rooms"
import { DEVICE_TYPES, DEVICE_TYPES_NAME_BY_TYPE } from "@/src/constants/devices_types"
import { Device } from "@/src/services/devices.service"
import { useState } from "react"

const NO_ROOM_VALUE = "__none__";

type DeviceFormValues = {
    name: string;
    deviceType: string;
    roomId: string;
};

type UpsertDeviceDialogProps = {
    device: Device;
    children: React.ReactElement;
};

function initialValues(device: Device): DeviceFormValues {
    return {
        name: device.name ?? "",
        deviceType: device.deviceType ?? "",
        roomId: device.roomId ? String(device.roomId) : NO_ROOM_VALUE,
    };
}

export function UpsertDeviceDialog({ device, children }: UpsertDeviceDialogProps) {
    const [open, setOpen] = useState(false);
    const [values, setValues] = useState<DeviceFormValues>(() => initialValues(device));
    const [formError, setFormError] = useState<string | null>(null);
    const { data: rooms } = useRooms();
    const { mutateAsync: updateDevice, isPending } = useUpdateDevice();

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
            setFormError(null);
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

        await updateDevice({
            deviceId: device.id,
            data: {
                name,
                deviceType: values.deviceType,
                roomId: values.roomId === NO_ROOM_VALUE ? null : Number(values.roomId),
            },
        });

        setOpen(false);
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogTrigger render={children} nativeButton={true} />
            <DialogContent>
                <form onSubmit={handleSubmit}>
                    <DialogHeader>
                        <DialogTitle>Editar dispositivo</DialogTitle>
                        <DialogDescription>
                            Altere nome, tipo e cômodo padrão.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="grid gap-4 py-6">
                        <div className="grid gap-2">
                            <Label htmlFor="device-name">Nome</Label>
                            <Input
                                id="device-name"
                                value={values.name}
                                disabled={isPending}
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
                                disabled={isPending}
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
                                disabled={isPending}
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

                        {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
                    </div>

                    <DialogFooter>
                        <Button type="button" variant="outline" disabled={isPending} onClick={() => setOpen(false)}>
                            Cancelar
                        </Button>
                        <Button type="submit" disabled={isPending}>
                            {isPending ? "Salvando..." : "Salvar"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
