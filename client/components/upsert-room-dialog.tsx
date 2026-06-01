import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldGroup } from "@/components/ui/field"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { useCreateRoom, useUpdateRoom } from "@/hooks/use-rooms"
import { useMemo, useState } from "react"
import { z } from "zod"
import { Room } from "@/src/services/rooms.service"
import { useFloors } from "@/hooks/use-floors"
import { DynamicIcon, IconName, iconNames } from "lucide-react/dynamic"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger } from "./ui/select"

const MAX_VISIBLE_ICONS = 80;
const NO_FLOOR_VALUE = "__none__";

const schema = z.object({
    name: z.string().min(1, "Nome e obrigatorio"),
    icon: z.string().optional(),
    floorId: z.string().optional(),
    description: z.string().optional(),
});

type RoomFormValues = z.infer<typeof schema>;

type UpsertRoomDialogProps = {
    room?: Room;
    children?: React.ReactElement;
};

const emptyValues: RoomFormValues = {
    name: "",
    icon: "",
    floorId: NO_FLOOR_VALUE,
    description: "",
};

function formatIconName(iconName: string) {
    return iconName
        .split("-")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
}

function getInitialValues(room?: Room): RoomFormValues {
    return {
        name: room?.name ?? "",
        icon: room?.icon ?? "",
        floorId: room?.floorId ? String(room.floorId) : NO_FLOOR_VALUE,
        description: room?.description ?? "",
    };
}

export function UpsertRoomDialog({ room, children }: UpsertRoomDialogProps) {
    const [open, setOpen] = useState(false);
    const [values, setValues] = useState<z.infer<typeof schema>>(() => getInitialValues(room));
    const [iconSearch, setIconSearch] = useState("");
    const [iconPickerOpen, setIconPickerOpen] = useState(false);
    const [errors, setErrors] = useState<Partial<Record<keyof RoomFormValues, string>>>({});
    const [formError, setFormError] = useState<string | null>(null);
    const { data: floors } = useFloors();
    const { mutateAsync: createRoom, isPending: isCreating } = useCreateRoom();
    const { mutateAsync: updateRoom, isPending: isUpdating } = useUpdateRoom();
    const isEditing = Boolean(room);
    const isPending = isCreating || isUpdating;
    const selectedIcon = values.icon && iconNames.includes(values.icon as IconName)
        ? values.icon as IconName
        : null;
    const filteredIcons = useMemo(() => {
        const search = iconSearch.trim().toLowerCase();

        return iconNames
            .filter((iconName) => !search || iconName.includes(search))
            .slice(0, MAX_VISIBLE_ICONS);
    }, [iconSearch]);

    const selectedFloorLabel = values.floorId === NO_FLOOR_VALUE
        ? "Sem piso"
        : floors?.find((floor) => String(floor.id) === values.floorId)?.name || "Piso";


    const handleOpenChange = (nextOpen: boolean) => {
        if (nextOpen) {
            setValues(getInitialValues(room));
            setIconSearch("");
            setIconPickerOpen(false);
            setErrors({});
            setFormError(null);
        }

        setOpen(nextOpen);
    };

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        const parsed = schema.safeParse(values);

        if (!parsed.success) {
            const nextErrors: Partial<Record<keyof RoomFormValues, string>> = {};

            for (const issue of parsed.error.issues) {
                const field = issue.path[0] as keyof RoomFormValues;
                if (!nextErrors[field]) {
                    nextErrors[field] = issue.message;
                }
            }

            setErrors(nextErrors);
            return;
        }

        setErrors({});
        setFormError(null);

        try {
            const payload = {
                name: parsed.data.name,
                icon: parsed.data.icon || null,
                floorId: values.floorId === NO_FLOOR_VALUE ? null : Number(values.floorId),
                description: parsed.data.description || null,
            };

            if (room) {
                await updateRoom({ roomId: room.id, data: payload });
            } else {
                await createRoom(payload);
                setValues(emptyValues);
            }

            setOpen(false);
        } catch (error) {
            if (error instanceof Error && error.message) {
                setFormError(error.message);
                return;
            }
            setFormError("Erro inesperado ao salvar comodo.");
        }
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            {children ? <DialogTrigger render={children} nativeButton={false} /> : null}
            <DialogContent className="sm:max-w-sm">
                <form onSubmit={handleSubmit}>
                    <DialogHeader>
                        <DialogTitle>{isEditing ? "Editar comodo" : "Novo comodo"}</DialogTitle>
                        <DialogDescription>
                            {isEditing ? "Atualize as informacoes do comodo." : "Crie um comodo para organizar seus dispositivos."}
                        </DialogDescription>
                    </DialogHeader>
                    <FieldGroup className="py-6">
                        <Field>
                            <Label htmlFor="room-name">Nome</Label>
                            <Input
                                id="room-name"
                                name="name"
                                placeholder="Ex: Sala, Cozinha, Quarto"
                                disabled={isPending}
                                aria-invalid={Boolean(errors.name)}
                                value={values.name}
                                onChange={(event) => {
                                    setValues((prev) => ({ ...prev, name: event.target.value }));
                                    setErrors((prev) => ({ ...prev, name: undefined }));
                                    setFormError(null);
                                }}
                            />
                            <FieldError>{errors.name}</FieldError>
                        </Field>
                        <Field>
                            <Label htmlFor="room-icon">Icone</Label>
                            <div className="relative">
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="w-full justify-between"
                                    disabled={isPending}
                                    onClick={() => setIconPickerOpen((prev) => !prev)}
                                >
                                    <span className="flex min-w-0 items-center gap-2">
                                        {selectedIcon ? <DynamicIcon name={selectedIcon} className="size-4 shrink-0" /> : null}
                                        <span className="truncate">
                                            {selectedIcon ? formatIconName(selectedIcon) : "Selecione um icone"}
                                        </span>
                                    </span>
                                    <span className="text-xs text-muted-foreground">{iconPickerOpen ? "Fechar" : "Buscar"}</span>
                                </Button>
                                {iconPickerOpen ? (
                                    <div className="absolute z-50 mt-2 w-full rounded-3xl bg-popover p-2 shadow-lg ring-1 ring-foreground/10">
                                        <Input
                                            id="room-icon"
                                            name="icon"
                                            placeholder="Buscar icone..."
                                            value={iconSearch}
                                            onChange={(event) => setIconSearch(event.target.value.toLowerCase())}
                                            disabled={isPending}
                                            autoComplete="off"
                                        />
                                        <div className="mt-2 max-h-64 overflow-y-auto">
                                            {selectedIcon ? (
                                                <button
                                                    type="button"
                                                    className="mb-1 flex w-full items-center gap-2 rounded-2xl px-3 py-2 text-left text-sm text-muted-foreground hover:bg-secondary"
                                                    onClick={() => {
                                                        setValues((prev) => ({ ...prev, icon: "" }));
                                                        setIconSearch("");
                                                        setIconPickerOpen(false);
                                                        setFormError(null);
                                                    }}
                                                >
                                                    Sem icone
                                                </button>
                                            ) : null}
                                            {filteredIcons.map((iconName) => (
                                                <button
                                                    key={iconName}
                                                    type="button"
                                                    className="flex w-full items-center gap-2 rounded-2xl px-3 py-2 text-left text-sm hover:bg-secondary"
                                                    onClick={() => {
                                                        setValues((prev) => ({ ...prev, icon: iconName }));
                                                        setIconSearch("");
                                                        setIconPickerOpen(false);
                                                        setFormError(null);
                                                    }}
                                                >
                                                    <DynamicIcon name={iconName} className="size-6 shrink-0" />
                                                    <span className="truncate">{formatIconName(iconName)}</span>
                                                </button>
                                            ))}
                                            {filteredIcons.length === 0 ? (
                                                <p className="px-3 py-2 text-sm text-muted-foreground">Nenhum icone encontrado.</p>
                                            ) : null}
                                        </div>
                                    </div>
                                ) : null}
                            </div>
                        </Field>
                        <Field>
                            <Label htmlFor="room-floor">Piso</Label>
                            <Select
                                value={values.floorId}
                                onValueChange={(value) => setValues((current) => ({ ...current, floorId: value || NO_FLOOR_VALUE }))}
                                disabled={isPending}
                            >
                                <SelectTrigger className="w-full">
                                    {selectedFloorLabel}
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        <SelectItem value={NO_FLOOR_VALUE}>Sem piso</SelectItem>
                                        {(floors ?? []).map((floor) => (
                                            <SelectItem key={floor.id} value={String(floor.id)}>
                                                {floor.name}
                                            </SelectItem>
                                        ))}
                                    </SelectGroup>
                                </SelectContent>
                            </Select>
                        </Field>
                        <Field>
                            <Label htmlFor="room-description">Descricao</Label>
                            <Input
                                id="room-description"
                                name="description"
                                placeholder="Descricao opcional"
                                disabled={isPending}
                                value={values.description}
                                onChange={(event) => {
                                    setValues((prev) => ({ ...prev, description: event.target.value }));
                                    setFormError(null);
                                }}
                            />
                        </Field>
                    </FieldGroup>
                    <FieldError className="text-center w-full mb-6">{formError}</FieldError>
                    <DialogFooter>
                        <DialogClose render={<Button variant="outline" disabled={isPending}>Cancelar</Button>} />
                        <Button type="submit" disabled={isPending}>
                            {isPending ? "Salvando..." : isEditing ? "Salvar" : "Criar"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}
