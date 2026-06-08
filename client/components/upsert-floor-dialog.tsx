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
import { useState } from "react"
import { z } from "zod"    
import { Floor } from "@/src/services/floors.service"
import { useCreateFloor, useUpdateFloor, useUploadFloorModel } from "@/hooks/use-floors"
import { useRouter } from "next/navigation"

const schema = z.object({
    name: z.string().min(1, "Nome e obrigatorio"),
    description: z.string().optional(),
});

type FloorFormValues = z.infer<typeof schema>;

type UpsertFloorDialogProps = {
    floor?: Floor;
    children?: React.ReactElement;
};

const emptyValues: FloorFormValues = {
    name: "",
    description: "",
};

function getInitialValues(floor?: Floor): FloorFormValues {
    return {
        name: floor?.name ?? "",
        description: floor?.description ?? "",
    };
}

export function UpsertFloorDialog({ floor, children, nativeButton = false, open: controlledOpen, onOpenChange }: UpsertFloorDialogProps & { nativeButton?: boolean, open?: boolean, onOpenChange?: (open: boolean) => void }) {
    const router = useRouter();
    const [internalOpen, setInternalOpen] = useState(false);
    const open = controlledOpen ?? internalOpen;
    const isControlled = controlledOpen !== undefined;
    const [values, setValues] = useState<FloorFormValues>(() => getInitialValues(floor));
    const [modelFile, setModelFile] = useState<File | null>(null);
    const [errors, setErrors] = useState<Partial<Record<keyof FloorFormValues, string>>>({});
    const [formError, setFormError] = useState<string | null>(null);
    const { mutateAsync: createFloor, isPending: isCreating } = useCreateFloor();
    const { mutateAsync: updateFloor, isPending: isUpdating } = useUpdateFloor();
    const { mutateAsync: uploadFloorModel, isPending: isUploadingModel } = useUploadFloorModel();
    const isEditing = Boolean(floor);
    const isPending = isCreating || isUpdating || isUploadingModel;


    const handleOpenChange = (nextOpen: boolean) => {

        if (nextOpen) {
            setValues(getInitialValues(floor));
            setModelFile(null);
            setErrors({});
            setFormError(null);
        }

        if (!isControlled) {
            setInternalOpen(nextOpen);
        }

        onOpenChange?.(nextOpen);
    };

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        const parsed = schema.safeParse(values);

        if (!parsed.success) {
            const nextErrors: Partial<Record<keyof FloorFormValues, string>> = {};

            for (const issue of parsed.error.issues) {
                const field = issue.path[0] as keyof FloorFormValues;
                if (!nextErrors[field]) {
                    nextErrors[field] = issue.message;
                }
            }

            setErrors(nextErrors);
            return;
        }

        setErrors({});
        setFormError(null);

        if (modelFile && !modelFile.name.toLowerCase().endsWith(".glb")) {
            setFormError("Modelo invalido. Use um arquivo .glb.");
            return;
        }

        try {
            const payload = {
                name: parsed.data.name,
                description: parsed.data.description || null,
            };

            let savedFloor = floor;

            if (floor) {
                savedFloor = await updateFloor({ floorId: floor.id, data: payload });
            } else {
                savedFloor = await createFloor(payload);
                setValues(emptyValues);
            }

            if (modelFile && savedFloor) {
                await uploadFloorModel({ floorId: savedFloor.id, file: modelFile });
                handleOpenChange(false);
                router.push(`/floor-editor?floorId=${savedFloor.id}`);
                return;
            }

            handleOpenChange(false);
        } catch (error) {
            if (error instanceof Error && error.message) {
                setFormError(error.message);
                return;
            }
            setFormError("Erro inesperado ao salvar piso.");
        }
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            {children ? <DialogTrigger render={children} nativeButton={nativeButton} /> : null}
            <DialogContent className="sm:max-w-sm">
                <form onSubmit={handleSubmit}>
                    <DialogHeader>
                        <DialogTitle>{isEditing ? "Editar piso" : "Novo piso"}</DialogTitle>
                        <DialogDescription>
                            {isEditing ? "Atualize as informacoes do piso." : "Crie um piso para organizar seus dispositivos."}
                        </DialogDescription>
                    </DialogHeader>
                    <FieldGroup className="py-6">
                        <Field>
                            <Label htmlFor="floor-name">Nome</Label>
                            <Input
                                id="floor-name"
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
                        <Field>
                            <Label htmlFor="floor-model">Modelo 3D (.glb)</Label>
                            <Input
                                id="floor-model"
                                name="model"
                                type="file"
                                accept=".glb,model/gltf-binary"
                                disabled={isPending}
                                onChange={(event) => {
                                    setModelFile(event.target.files?.[0] ?? null);
                                    setFormError(null);
                                }}
                            />
                            <p className="text-xs text-muted-foreground">
                                {floor?.modelUrl ? "Este piso ja tem modelo 3D." : "Envie um .glb para liberar a edição 3D."}
                            </p>
                        </Field>
                    </FieldGroup>
                    <FieldError className="text-center w-full mb-6">{formError}</FieldError>
                    <DialogFooter>
                        <DialogClose render={<Button variant="outline" disabled={isPending}>Cancelar</Button>} />
                        <Button type="submit" disabled={isPending}>
                            {isPending ? "Salvando..." : modelFile ? "Enviar e editar 3D" : isEditing ? "Salvar" : "Criar"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}
