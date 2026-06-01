"use client"

import { type FormEvent, type ReactElement, useMemo, useState } from "react"
import { z } from "zod"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Field, FieldError, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useCreateAutomation, useDeleteAutomation, useUpdateAutomation } from "@/hooks/use-automations"
import { useDevices } from "@/hooks/use-devices"
import { useEntities } from "@/hooks/use-entities"
import { useRooms } from "@/hooks/use-rooms"
import { useScenes } from "@/hooks/use-scenes"
import { Automation, UpsertAutomationPayload } from "@/src/services/automations.service"
import { Device } from "@/src/services/devices.service"
import { Entity } from "@/src/services/entities.service"

const triggerSchema = z.object({
    type: z.enum(["device_state_changed", "entity_state_changed"]),
    deviceId: z.number().int().positive().nullable().optional(),
    entityId: z.number().int().positive().nullable().optional(),
    config: z.record(z.string(), z.unknown()).default({}),
}).superRefine((value, context) => {
    if (value.type === "device_state_changed" && !value.deviceId) {
        context.addIssue({ code: "custom", path: ["deviceId"], message: "Selecione um dispositivo" })
    }

    if (value.type === "entity_state_changed" && !value.entityId) {
        context.addIssue({ code: "custom", path: ["entityId"], message: "Selecione uma entidade" })
    }
})

const schema = z.object({
    name: z.string().min(1, "Nome e obrigatorio"),
    description: z.string().optional(),
    enabled: z.boolean(),
    roomId: z.number().int().positive().nullable().optional(),
    sceneId: z.number().int().positive("Selecione uma scene"),
    trigger: triggerSchema,
})

type AutomationFormValues = {
    name: string;
    description: string;
    enabled: boolean;
    roomId: string;
    sceneId: string;
    triggerType: "device_state_changed" | "entity_state_changed";
    deviceId: string;
    entityId: string;
    targetQuery: string;
}

type UpsertAutomationDialogProps = {
    automation?: Automation;
    children?: ReactElement;
}

function buildInitialValues(automation?: Automation): AutomationFormValues {
    return {
        name: automation?.name ?? "",
        description: automation?.description ?? "",
        enabled: automation?.enabled ?? true,
        roomId: automation?.roomId ? String(automation.roomId) : "",
        sceneId: automation?.sceneId ? String(automation.sceneId) : "",
        triggerType: automation?.trigger.type ?? "device_state_changed",
        deviceId: automation?.trigger.deviceId ? String(automation.trigger.deviceId) : "",
        entityId: automation?.trigger.entityId ? String(automation.trigger.entityId) : "",
        targetQuery: "",
    }
}

function entityLabel(entity: Entity, deviceById: Map<number, Device>) {
    const device = deviceById.get(entity.deviceId)
    return `${entity.name}${device?.name ? ` • ${device.name}` : ""}`
}

export function UpsertAutomationDialog({ automation, children }: UpsertAutomationDialogProps) {
    const [open, setOpen] = useState(false)
    const [values, setValues] = useState<AutomationFormValues>(() => buildInitialValues(automation))
    const [formError, setFormError] = useState<string | null>(null)
    const [errors, setErrors] = useState<Record<string, string>>({})
    const { data: rooms = [] } = useRooms()
    const { data: scenes = [] } = useScenes()
    const { data: devices = [] } = useDevices()
    const { data: entities = [] } = useEntities()
    const { mutateAsync: createAutomation, isPending: isCreating } = useCreateAutomation()
    const { mutateAsync: updateAutomation, isPending: isUpdating } = useUpdateAutomation()
    const { mutateAsync: deleteAutomation, isPending: isDeleting } = useDeleteAutomation()

    const isBusy = isCreating || isUpdating || isDeleting
    const isEditing = Boolean(automation)
    const deviceOptions = useMemo(() => [...devices].sort((left, right) => left.name.localeCompare(right.name, "pt-BR")), [devices])
    const deviceById = useMemo(() => new Map(deviceOptions.map((device) => [device.id, device])), [deviceOptions])
    const entityOptions = useMemo(
        () => [...entities].sort((left, right) => entityLabel(left, deviceById).localeCompare(entityLabel(right, deviceById), "pt-BR")),
        [deviceById, entities],
    )
    const filteredDeviceOptions = useMemo(() => {
        const search = values.targetQuery.trim().toLowerCase()
        return deviceOptions.filter((device) => {
            const haystack = `${device.name} ${device.roomName ?? ""} ${device.deviceType}`.toLowerCase()
            return !search || haystack.includes(search)
        })
    }, [deviceOptions, values.targetQuery])
    const filteredEntityOptions = useMemo(() => {
        const search = values.targetQuery.trim().toLowerCase()
        return entityOptions.filter((entity) => {
            const haystack = `${entityLabel(entity, deviceById)} ${entity.type}`.toLowerCase()
            return !search || haystack.includes(search)
        })
    }, [deviceById, entityOptions, values.targetQuery])

    const handleOpenChange = (nextOpen: boolean) => {
        if (nextOpen) {
            setValues(buildInitialValues(automation))
            setErrors({})
            setFormError(null)
        }

        setOpen(nextOpen)
    }

    const handleTriggerTypeChange = (triggerType: AutomationFormValues["triggerType"]) => {
        setValues((current) => ({
            ...current,
            triggerType,
            deviceId: "",
            entityId: "",
            targetQuery: "",
        }))
        setFormError(null)
    }

    const toPayload = (): UpsertAutomationPayload => {
        const parsed = schema.safeParse({
            name: values.name,
            description: values.description || undefined,
            enabled: values.enabled,
            roomId: values.roomId ? Number(values.roomId) : null,
            sceneId: Number(values.sceneId),
            trigger: {
                type: values.triggerType,
                deviceId: values.triggerType === "device_state_changed" && values.deviceId ? Number(values.deviceId) : null,
                entityId: values.triggerType === "entity_state_changed" && values.entityId ? Number(values.entityId) : null,
                config: {},
            },
        })

        if (!parsed.success) {
            const nextErrors: Record<string, string> = {}
            for (const issue of parsed.error.issues) {
                nextErrors[issue.path.join(".")] = issue.message
            }
            setErrors(nextErrors)
            throw new Error("Corrija os campos obrigatórios da automação.")
        }

        const nextErrors: Record<string, string> = {}

        if (!scenes.some((scene) => scene.id === parsed.data.sceneId)) {
            nextErrors.sceneId = "Selecione uma scene válida"
        }

        if (parsed.data.trigger.type === "device_state_changed" && !deviceOptions.some((device) => device.id === parsed.data.trigger.deviceId)) {
            nextErrors["trigger.deviceId"] = "Selecione um dispositivo válido"
        }

        if (parsed.data.trigger.type === "entity_state_changed" && !entityOptions.some((entity) => entity.id === parsed.data.trigger.entityId)) {
            nextErrors["trigger.entityId"] = "Selecione uma entidade válida"
        }

        if (Object.keys(nextErrors).length) {
            setErrors(nextErrors)
            throw new Error("Corrija os campos obrigatórios da automação.")
        }

        setErrors({})
        return parsed.data
    }

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        setFormError(null)

        try {
            const payload = toPayload()

            if (automation) {
                await updateAutomation({ automationId: automation.id, data: payload })
            } else {
                await createAutomation(payload)
            }

            setOpen(false)
        } catch (error) {
            setFormError(error instanceof Error ? error.message : "Erro inesperado ao salvar automação.")
        }
    }

    const handleDelete = async () => {
        if (!automation) return
        setFormError(null)

        try {
            await deleteAutomation(automation.id)
            setOpen(false)
        } catch (error) {
            setFormError(error instanceof Error ? error.message : "Erro inesperado ao excluir automação.")
        }
    }

    const targetOptions = values.triggerType === "device_state_changed" ? filteredDeviceOptions : filteredEntityOptions

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            {children ? <DialogTrigger render={children} nativeButton={false} /> : null}
            <DialogContent className="sm:max-w-2xl">
                <form onSubmit={handleSubmit}>
                    <DialogHeader>
                        <DialogTitle>{isEditing ? "Editar automação" : "Nova automação"}</DialogTitle>
                        <DialogDescription>
                            No MVP, a automação dispara em qualquer mudança de estado do alvo selecionado e executa uma scene vinculada.
                        </DialogDescription>
                    </DialogHeader>

                    <FieldGroup className="py-6">
                        <div className="grid gap-4 md:grid-cols-2">
                            <Field>
                                <Label htmlFor="automation-name">Nome</Label>
                                <Input
                                    id="automation-name"
                                    value={values.name}
                                    disabled={isBusy}
                                    onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))}
                                />
                                <FieldError>{errors.name}</FieldError>
                            </Field>
                            <Field>
                                <Label htmlFor="automation-status">Status</Label>
                                <select
                                    id="automation-status"
                                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
                                    value={values.enabled ? "enabled" : "disabled"}
                                    disabled={isBusy}
                                    onChange={(event) => setValues((current) => ({ ...current, enabled: event.target.value === "enabled" }))}
                                >
                                    <option value="enabled">Ativa</option>
                                    <option value="disabled">Pausada</option>
                                </select>
                            </Field>
                        </div>

                        <Field>
                            <Label htmlFor="automation-description">Descrição</Label>
                            <Textarea
                                id="automation-description"
                                rows={3}
                                value={values.description}
                                disabled={isBusy}
                                onChange={(event) => setValues((current) => ({ ...current, description: event.target.value }))}
                            />
                        </Field>

                        <div className="grid gap-4 md:grid-cols-2">
                            <Field>
                                <Label htmlFor="automation-room">Cômodo</Label>
                                <select
                                    id="automation-room"
                                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
                                    value={values.roomId}
                                    disabled={isBusy}
                                    onChange={(event) => setValues((current) => ({ ...current, roomId: event.target.value }))}
                                >
                                    <option value="">Sem cômodo</option>
                                    {rooms.map((room) => (
                                        <option key={room.id} value={String(room.id)}>{room.name}</option>
                                    ))}
                                </select>
                            </Field>
                            <Field>
                                <Label htmlFor="automation-scene">Scene vinculada</Label>
                                <select
                                    id="automation-scene"
                                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
                                    value={values.sceneId}
                                    disabled={isBusy}
                                    onChange={(event) => setValues((current) => ({ ...current, sceneId: event.target.value }))}
                                >
                                    <option value="">Selecione</option>
                                    {scenes.map((scene) => (
                                        <option key={scene.id} value={String(scene.id)}>{scene.name}</option>
                                    ))}
                                </select>
                                <FieldError>{errors.sceneId}</FieldError>
                            </Field>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                            <Field>
                                <Label htmlFor="automation-trigger-type">Tipo de trigger</Label>
                                <select
                                    id="automation-trigger-type"
                                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
                                    value={values.triggerType}
                                    disabled={isBusy}
                                    onChange={(event) => handleTriggerTypeChange(event.target.value as AutomationFormValues["triggerType"])}
                                >
                                    <option value="device_state_changed">Mudança de estado do device</option>
                                    <option value="entity_state_changed">Mudança de estado da entidade</option>
                                </select>
                            </Field>
                            <Field>
                                <Label htmlFor="automation-target-search">Buscar alvo</Label>
                                <Input
                                    id="automation-target-search"
                                    value={values.targetQuery}
                                    placeholder={values.triggerType === "device_state_changed" ? "Nome, cômodo ou tipo" : "Nome da entidade ou device"}
                                    disabled={isBusy}
                                    onChange={(event) => setValues((current) => ({ ...current, targetQuery: event.target.value }))}
                                />
                            </Field>
                        </div>

                        <Field>
                            <Label htmlFor="automation-target">{values.triggerType === "device_state_changed" ? "Dispositivo" : "Entidade"}</Label>
                            <select
                                id="automation-target"
                                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
                                value={values.triggerType === "device_state_changed" ? values.deviceId : values.entityId}
                                disabled={isBusy}
                                onChange={(event) => {
                                    const nextValue = event.target.value
                                    setValues((current) => current.triggerType === "device_state_changed"
                                        ? { ...current, deviceId: nextValue }
                                        : { ...current, entityId: nextValue },
                                    )
                                }}
                            >
                                <option value="">Selecione</option>
                                {values.triggerType === "device_state_changed"
                                    ? filteredDeviceOptions.map((device) => (
                                        <option key={device.id} value={String(device.id)}>
                                            {device.name}{device.roomName ? ` • ${device.roomName}` : ""}
                                        </option>
                                    ))
                                    : filteredEntityOptions.map((entity) => (
                                        <option key={entity.id} value={String(entity.id)}>
                                            {entityLabel(entity, deviceById)}
                                        </option>
                                    ))}
                            </select>
                            <FieldError>{errors[values.triggerType === "device_state_changed" ? "trigger.deviceId" : "trigger.entityId"]}</FieldError>
                        </Field>

                        <p className="text-xs text-muted-foreground">
                            {targetOptions.length} alvo(s) disponível(is). O runner automático usa os device_events e ignora eventos originados por scene para evitar loop no MVP.
                        </p>
                    </FieldGroup>

                    <FieldError className="mb-6 w-full text-center">{formError}</FieldError>

                    <DialogFooter className="gap-2 sm:justify-between">
                        <div>
                            {automation ? (
                                <Button type="button" variant="destructive" disabled={isBusy} onClick={handleDelete}>
                                    Excluir automação
                                </Button>
                            ) : null}
                        </div>
                        <div className="flex gap-2">
                            <Button type="button" variant="outline" disabled={isBusy} onClick={() => setOpen(false)}>
                                Cancelar
                            </Button>
                            <Button type="submit" disabled={isBusy}>
                                {automation ? "Salvar" : "Criar automação"}
                            </Button>
                        </div>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}