"use client"

import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Field, FieldError, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useCreateScene, useDeleteScene, useUpdateScene } from "@/hooks/use-scenes"
import { useDevices } from "@/hooks/use-devices"
import { useEntities } from "@/hooks/use-entities"
import { useRooms } from "@/hooks/use-rooms"
import { Entity } from "@/src/services/entities.service"
import { Scene, UpsertScenePayload } from "@/src/services/scenes.service"
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon } from "lucide-react"
import { useMemo, useState } from "react"
import { z } from "zod"

const commandOptions = {
    default: [
        { value: "turn_on", label: "Ligar" },
        { value: "turn_off", label: "Desligar" },
    ],
    cover: [
        { value: "open", label: "Abrir" },
        { value: "close", label: "Fechar" },
        { value: "stop", label: "Parar" },
        { value: "set_position", label: "Ir para posição" },
    ],
}

const actionSchema = z.object({
    deviceId: z.number().int().positive("Selecione um dispositivo"),
    orderIndex: z.number().int().positive(),
    command: z.string().min(1, "Selecione um comando"),
    params: z.record(z.string(), z.unknown()),
})

const schema = z.object({
    name: z.string().min(1, "Nome e obrigatorio"),
    description: z.string().optional(),
    roomId: z.number().int().positive().nullable().optional(),
    actions: z.array(actionSchema).min(1, "Adicione pelo menos uma acao"),
})

type SceneFormAction = {
    key: string;
    deviceId?: number;
    entityId?: number;
    command: string;
    position: string;
}

type SceneTarget = {
    key: string;
    deviceId: number;
    entityId?: number;
    name: string;
    roomId?: number | null;
    roomName?: string | null;
    deviceType?: string;
}

type SceneFormValues = {
    name: string;
    description: string;
    roomId: string;
    actions: SceneFormAction[];
}

type UpsertSceneDialogProps = {
    scene?: Scene;
    children?: React.ReactElement;
}

function deviceGroup(deviceType: string | undefined) {
    const normalized = String(deviceType || "").toLowerCase()
    if (["cover", "blind", "curtain", "shade"].some((token) => normalized.includes(token))) return "cover"
    return "default"
}

function defaultCommand(deviceType: string | undefined) {
    return commandOptions[deviceGroup(deviceType)][0]?.value ?? "turn_on"
}

function entitySwitchCode(entity: Entity | undefined): string {
    return String(entity?.commandSchema.switchCode || "")
}

function entityDpsId(entity: Entity | undefined): string | undefined {
    const code = entitySwitchCode(entity)
    if (!code) return undefined
    if (code === "switch_led") return "20"
    if (code === "switch") return "1"
    return code.startsWith("switch_") ? code.slice("switch_".length) : code
}

function buildInitialValues(scene?: Scene): SceneFormValues {
    return {
        name: scene?.name ?? "",
        description: scene?.description ?? "",
        roomId: scene?.roomId ? String(scene.roomId) : "",
        actions: scene?.actions?.length
            ? scene.actions.map((action) => ({
                key: `action-${action.id}`,
                deviceId: action.deviceId,
                entityId: Number(action.params.entityId) || undefined,
                command: action.command,
                position: String(action.params.position ?? "50"),
            }))
            : [{ key: `new-${Date.now()}`, deviceId: undefined, command: "turn_on", position: "50" }],
    }
}

export function UpsertSceneDialog({ scene, children }: UpsertSceneDialogProps) {
    const [open, setOpen] = useState(false)
    const [values, setValues] = useState<SceneFormValues>(() => buildInitialValues(scene))
    const [deviceQuery, setDeviceQuery] = useState("")
    const [roomFilter, setRoomFilter] = useState("")
    const [formError, setFormError] = useState<string | null>(null)
    const [errors, setErrors] = useState<Record<string, string>>({})
    const { data: devices = [] } = useDevices()
    const { data: entities = [] } = useEntities()
    const { data: rooms = [] } = useRooms()
    const { mutateAsync: createScene, isPending: isCreating } = useCreateScene()
    const { mutateAsync: updateScene, isPending: isUpdating } = useUpdateScene()
    const { mutateAsync: deleteScene, isPending: isDeleting } = useDeleteScene()

    const isEditing = Boolean(scene)
    const isBusy = isCreating || isUpdating || isDeleting
    const deviceOptions = useMemo(
        () => [...devices].sort((left, right) => left.name.localeCompare(right.name, "pt-BR")),
        [devices],
    )
    const targetOptions = useMemo(
        () => deviceOptions.flatMap<SceneTarget>((device) => {
            const deviceEntities = entities.filter((entity) => entity.deviceId === device.id && entitySwitchCode(entity))
            if (deviceEntities.length < 2) {
                return [{ key: `device:${device.id}`, deviceId: device.id, name: device.name, roomId: device.roomId, roomName: device.roomName, deviceType: device.deviceType }]
            }
            return deviceEntities.map((entity) => ({
                key: `entity:${entity.id}`,
                deviceId: device.id,
                entityId: entity.id,
                name: entity.name,
                roomId: device.roomId,
                roomName: device.roomName,
                deviceType: device.deviceType,
            }))
        }),
        [deviceOptions, entities],
    )
    const filteredTargetOptions = useMemo(() => {
        const search = deviceQuery.trim().toLowerCase()

        return targetOptions.filter((target) => {
            const matchesRoom = !roomFilter || String(target.roomId ?? "") === roomFilter
            const haystack = `${target.name} ${target.roomName ?? ""} ${target.deviceType ?? ""}`.toLowerCase()
            const matchesSearch = !search || haystack.includes(search)
            return matchesRoom && matchesSearch
        })
    }, [targetOptions, deviceQuery, roomFilter])

    const handleOpenChange = (nextOpen: boolean) => {
        if (nextOpen) {
            setValues(buildInitialValues(scene))
            setDeviceQuery("")
            setRoomFilter("")
            setErrors({})
            setFormError(null)
        }

        setOpen(nextOpen)
    }

    const updateAction = (index: number, nextAction: Partial<SceneFormAction>) => {
        setValues((current) => ({
            ...current,
            actions: current.actions.map((action, actionIndex) => actionIndex === index ? { ...action, ...nextAction } : action),
        }))
        setFormError(null)
    }

    const addAction = () => {
        setValues((current) => ({
            ...current,
            actions: [...current.actions, { key: `new-${Date.now()}-${current.actions.length}`, deviceId: undefined, command: "turn_on", position: "50" }],
        }))
    }

    const duplicateAction = (index: number) => {
        setValues((current) => {
            const nextActions = [...current.actions]
            const target = current.actions[index]
            nextActions.splice(index + 1, 0, { ...target, key: `duplicate-${Date.now()}-${index}` })
            return { ...current, actions: nextActions }
        })
        setFormError(null)
    }

    const removeAction = (index: number) => {
        setValues((current) => ({
            ...current,
            actions: current.actions.filter((_, actionIndex) => actionIndex !== index),
        }))
    }

    const moveAction = (index: number, direction: -1 | 1) => {
        setValues((current) => {
            const nextIndex = index + direction
            if (nextIndex < 0 || nextIndex >= current.actions.length) return current
            const nextActions = [...current.actions]
            const [item] = nextActions.splice(index, 1)
            nextActions.splice(nextIndex, 0, item)
            return { ...current, actions: nextActions }
        })
    }

    const availableTargetsForAction = (deviceId?: number, entityId?: number) => {
        const selectedTarget = targetOptions.find((target) => target.deviceId === deviceId && target.entityId === entityId)
        if (!selectedTarget) return filteredTargetOptions
        if (filteredTargetOptions.some((target) => target.key === selectedTarget.key)) return filteredTargetOptions
        return [selectedTarget, ...filteredTargetOptions]
    }

    const toPayload = (): UpsertScenePayload => {
        const parsed = schema.safeParse({
            name: values.name,
            description: values.description || undefined,
            roomId: values.roomId ? Number(values.roomId) : null,
            actions: values.actions.map((action, index) => ({
                deviceId: Number(action.deviceId),
                orderIndex: index + 1,
                command: action.command,
                params: {
                    ...(action.command === "set_position" ? { position: Number(action.position) } : {}),
                    ...(action.entityId ? { entityId: action.entityId, dpsId: entityDpsId(entities.find((entity) => entity.id === action.entityId)) } : {}),
                },
            })),
        })

        if (!parsed.success) {
            const nextErrors: Record<string, string> = {}
            for (const issue of parsed.error.issues) {
                nextErrors[issue.path.join(".")] = issue.message
            }
            setErrors(nextErrors)
            throw new Error("Corrija os campos obrigatorios da cena.")
        }

        const nextErrors: Record<string, string> = {}

        parsed.data.actions.forEach((action, index) => {
            if (!deviceOptions.some((device) => device.id === action.deviceId)) {
                nextErrors[`actions.${index}.deviceId`] = "Selecione um dispositivo válido"
            }

            if (action.command === "set_position") {
                const position = Number(action.params.position)
                if (!Number.isFinite(position) || position < 0 || position > 100) {
                    nextErrors[`actions.${index}.params.position`] = "Informe uma posição entre 0 e 100"
                }
            }
        })

        if (Object.keys(nextErrors).length) {
            setErrors(nextErrors)
            throw new Error("Corrija os campos obrigatórios da cena.")
        }

        setErrors({})
        return parsed.data
    }

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        setFormError(null)

        try {
            const payload = toPayload()

            if (scene) {
                await updateScene({ sceneId: scene.id, data: payload })
            } else {
                await createScene(payload)
            }

            setOpen(false)
        } catch (error) {
            setFormError(error instanceof Error ? error.message : "Erro inesperado ao salvar cena.")
        }
    }

    const handleDelete = async () => {
        if (!scene) return
        setFormError(null)
        try {
            await deleteScene(scene.id)
            setOpen(false)
        } catch (error) {
            setFormError(error instanceof Error ? error.message : "Erro inesperado ao excluir cena.")
        }
    }

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            {children ? <DialogTrigger render={children} nativeButton={false} /> : null}
            <DialogContent className="sm:max-w-3xl">
                <form onSubmit={handleSubmit}>
                    <DialogHeader>
                        <DialogTitle>{isEditing ? "Editar cena" : "Nova cena"}</DialogTitle>
                        <DialogDescription>
                            Monte uma sequência manual de ações para dispositivos já onboarded.
                        </DialogDescription>
                    </DialogHeader>

                    <FieldGroup className="py-6">
                        <div className="grid gap-4 md:grid-cols-2">
                            <Field>
                                <Label htmlFor="scene-name">Nome</Label>
                                <Input
                                    id="scene-name"
                                    value={values.name}
                                    disabled={isBusy}
                                    onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))}
                                />
                                <FieldError>{errors.name}</FieldError>
                            </Field>
                            <Field>
                                <Label htmlFor="scene-room">Cômodo</Label>
                                <select
                                    id="scene-room"
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
                        </div>

                        <Field>
                            <Label htmlFor="scene-description">Descrição</Label>
                            <Textarea
                                id="scene-description"
                                rows={3}
                                value={values.description}
                                disabled={isBusy}
                                onChange={(event) => setValues((current) => ({ ...current, description: event.target.value }))}
                            />
                        </Field>

                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h3 className="text-sm font-medium">Ações</h3>
                                    <p className="text-xs text-muted-foreground">Ordene os comandos como eles devem rodar.</p>
                                </div>
                                <Button type="button" variant="outline" size="sm" disabled={isBusy} onClick={addAction}>
                                    <PlusIcon className="size-4" />
                                    Adicionar ação
                                </Button>
                            </div>

                            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
                                <Field>
                                    <Label htmlFor="scene-device-search">Buscar dispositivo</Label>
                                    <Input
                                        id="scene-device-search"
                                        placeholder="Nome, cômodo ou tipo"
                                        value={deviceQuery}
                                        disabled={isBusy}
                                        onChange={(event) => setDeviceQuery(event.target.value)}
                                    />
                                </Field>
                                <Field>
                                    <Label htmlFor="scene-room-filter">Filtrar por cômodo</Label>
                                    <select
                                        id="scene-room-filter"
                                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
                                        value={roomFilter}
                                        disabled={isBusy}
                                        onChange={(event) => setRoomFilter(event.target.value)}
                                    >
                                        <option value="">Todos os cômodos</option>
                                        {rooms.map((room) => (
                                            <option key={room.id} value={String(room.id)}>{room.name}</option>
                                        ))}
                                    </select>
                                </Field>
                            </div>

                            <p className="text-xs text-muted-foreground">
                                {filteredTargetOptions.length} dispositivo(s) ou canal(is) visíveis para seleção.
                            </p>

                            <FieldError>{errors.actions}</FieldError>

                            {filteredTargetOptions.length === 0 ? (
                                <div className="rounded-2xl border border-dashed px-4 py-3 text-sm text-muted-foreground">
                                    Nenhum dispositivo encontrado com os filtros atuais.
                                </div>
                            ) : null}

                            {values.actions.map((action, index) => {
                                const selectedDevice = deviceOptions.find((device) => device.id === action.deviceId)
                                const selectedTarget = targetOptions.find((target) => target.deviceId === action.deviceId && target.entityId === action.entityId)
                                const commands = commandOptions[deviceGroup(selectedDevice?.deviceType)]
                                const availableTargets = availableTargetsForAction(action.deviceId, action.entityId)

                                return (
                                    <div key={action.key} className="rounded-2xl border p-4">
                                        <div className="mb-3 flex items-center justify-between gap-3">
                                            <div>
                                                <p className="font-medium">Ação {index + 1}</p>
                                                <p className="text-xs text-muted-foreground">{selectedTarget?.name ?? "Selecione um dispositivo ou canal"}</p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Button type="button" size="sm" variant="outline" disabled={isBusy} onClick={() => duplicateAction(index)}>
                                                    Duplicar
                                                </Button>
                                                <Button type="button" size="icon" variant="outline" disabled={isBusy || index === 0} onClick={() => moveAction(index, -1)}>
                                                    <ArrowUpIcon className="size-4" />
                                                </Button>
                                                <Button type="button" size="icon" variant="outline" disabled={isBusy || index === values.actions.length - 1} onClick={() => moveAction(index, 1)}>
                                                    <ArrowDownIcon className="size-4" />
                                                </Button>
                                                <Button type="button" size="icon" variant="destructive" disabled={isBusy || values.actions.length === 1} onClick={() => removeAction(index)}>
                                                    <Trash2Icon className="size-4" />
                                                </Button>
                                            </div>
                                        </div>

                                        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                                            <Field className="xl:col-span-2">
                                                <Label>Dispositivo ou canal</Label>
                                                <select
                                                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
                                                    value={selectedTarget?.key ?? ""}
                                                    disabled={isBusy || availableTargets.length === 0}
                                                    onChange={(event) => {
                                                        if (!event.target.value) {
                                                            updateAction(index, { deviceId: undefined, entityId: undefined, command: "turn_on" })
                                                            return
                                                        }

                                                        const target = targetOptions.find((item) => item.key === event.target.value)
                                                        updateAction(index, { deviceId: target?.deviceId, entityId: target?.entityId, command: defaultCommand(target?.deviceType) })
                                                    }}
                                                >
                                                    <option value="">Selecione</option>
                                                    {availableTargets.map((target) => (
                                                        <option key={target.key} value={target.key}>
                                                            {target.name} {target.roomName ? `• ${target.roomName}` : ""}
                                                        </option>
                                                    ))}
                                                </select>
                                                <FieldError>{errors[`actions.${index}.deviceId`]}</FieldError>
                                            </Field>

                                            <Field>
                                                <Label>Comando</Label>
                                                <select
                                                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
                                                    value={action.command}
                                                    disabled={isBusy || !action.deviceId}
                                                    onChange={(event) => updateAction(index, { command: event.target.value })}
                                                >
                                                    {commands.map((command) => (
                                                        <option key={command.value} value={command.value}>{command.label}</option>
                                                    ))}
                                                </select>
                                                <FieldError>{errors[`actions.${index}.command`]}</FieldError>
                                            </Field>

                                            <Field>
                                                <Label>Parâmetro</Label>
                                                {action.command === "set_position" ? (
                                                    <Input
                                                        type="number"
                                                        min={0}
                                                        max={100}
                                                        value={action.position}
                                                        disabled={isBusy}
                                                        onChange={(event) => updateAction(index, { position: event.target.value })}
                                                    />
                                                ) : (
                                                    <Input value="Sem parâmetros" disabled />
                                                )}
                                                <FieldError>{errors[`actions.${index}.params.position`]}</FieldError>
                                            </Field>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </FieldGroup>

                    <FieldError className="mb-6 w-full text-center">{formError}</FieldError>

                    <DialogFooter className="gap-2 sm:justify-between">
                        <div>
                            {scene ? (
                                <Button type="button" variant="destructive" disabled={isBusy} onClick={handleDelete}>
                                    Excluir cena
                                </Button>
                            ) : null}
                        </div>
                        <div className="flex gap-2">
                            <DialogClose render={<Button variant="outline" disabled={isBusy}>Cancelar</Button>} />
                            <Button type="submit" disabled={isBusy}>
                                {isBusy ? "Salvando..." : scene ? "Salvar" : "Criar"}
                            </Button>
                        </div>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}
