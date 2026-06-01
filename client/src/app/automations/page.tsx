"use client"

import { UpsertAutomationDialog } from "@/components/upsert-automation-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useAutomationRuns, useAutomations, useUpdateAutomation } from "@/hooks/use-automations"
import { useDevices } from "@/hooks/use-devices"
import { useEntities } from "@/hooks/use-entities"
import { Automation, AutomationRun } from "@/src/services/automations.service"
import { Device } from "@/src/services/devices.service"
import { Entity } from "@/src/services/entities.service"
import { CircleAlertIcon, CircleCheckIcon, PlusCircleIcon, Settings2Icon } from "lucide-react"
import { useMemo } from "react"

export default function AutomationsPage() {
    const { data: automations = [], isLoading, isError } = useAutomations()
    const { data: devices = [] } = useDevices()
    const { data: entities = [] } = useEntities()

    const deviceById = useMemo(() => new Map(devices.map((device) => [device.id, device])), [devices])
    const entityById = useMemo(() => new Map(entities.map((entity) => [entity.id, entity])), [entities])

    return (
        <main className="flex flex-1 flex-col gap-4 px-4 lg:px-6">
            <section className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-semibold">Automations</h1>
                    <p className="text-sm text-muted-foreground">Reaja a mudanças de estado e execute scenes automaticamente.</p>
                </div>
                <UpsertAutomationDialog>
                    <Button variant="outline">
                        <PlusCircleIcon className="size-4" />
                        Nova automação
                    </Button>
                </UpsertAutomationDialog>
            </section>

            {isLoading ? (
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                    {[1, 2].map((item) => (
                        <Card key={item} className="min-h-56 animate-pulse bg-secondary/40" />
                    ))}
                </div>
            ) : null}

            {isError ? (
                <Card>
                    <CardContent className="py-8 text-sm text-destructive">Erro ao carregar automations.</CardContent>
                </Card>
            ) : null}

            {!isLoading && !isError && automations.length === 0 ? (
                <Card>
                    <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
                        <Settings2Icon className="size-10 text-muted-foreground" />
                        <div>
                            <p className="font-medium">Nenhuma automação criada</p>
                            <p className="text-sm text-muted-foreground">Vincule um trigger de device ou entidade a uma scene para começar a automatizar a casa.</p>
                        </div>
                    </CardContent>
                </Card>
            ) : null}

            <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                {automations.map((automation) => (
                    <AutomationCard
                        key={automation.id}
                        automation={automation}
                        deviceById={deviceById}
                        entityById={entityById}
                    />
                ))}
            </section>
        </main>
    )
}

function AutomationCard({
    automation,
    deviceById,
    entityById,
}: {
    automation: Automation;
    deviceById: Map<number, Device>;
    entityById: Map<number, Entity>;
}) {
    const { data: runs = [] } = useAutomationRuns(automation.id, 5)
    const { mutateAsync: updateAutomation, isPending } = useUpdateAutomation()
    const latestRun = runs[0]
    const summary = runSummary(latestRun)

    return (
        <Card>
            <CardHeader className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <CardTitle>{automation.name}</CardTitle>
                        <p className="text-sm text-muted-foreground">{automation.description || "Sem descrição"}</p>
                    </div>
                    <Badge variant={automation.enabled ? "secondary" : "outline"}>{automation.enabled ? "Ativa" : "Pausada"}</Badge>
                </div>
                <div className="space-y-1 text-xs text-muted-foreground">
                    <p>{triggerLabel(automation, deviceById, entityById)}</p>
                    <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">Scene: {automation.sceneName || `#${automation.sceneId}`}</Badge>
                        <Badge variant="outline">{automation.roomName || "Sem cômodo"}</Badge>
                        <span>Atualizada em {new Date(automation.updatedAt).toLocaleString("pt-BR")}</span>
                    </div>
                </div>
            </CardHeader>

            <CardContent className="space-y-4">
                <div className="rounded-2xl border bg-secondary/20 p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                            <p className="text-sm font-medium">Execuções recentes</p>
                            <p className="text-xs text-muted-foreground">
                                {latestRun ? `Última em ${new Date(latestRun.createdAt).toLocaleString("pt-BR")}` : "Ainda não executada"}
                            </p>
                        </div>
                        <Badge variant="outline">{runs.length} run(s)</Badge>
                    </div>

                    {latestRun ? (
                        <div className="space-y-2 text-sm">
                            <p className="text-muted-foreground">
                                {numberFromSummary(summary, "successCount")} sucesso(s) • {numberFromSummary(summary, "errorCount")} erro(s)
                            </p>
                            <div className="space-y-2">
                                {runs.map((run) => (
                                    <AutomationRunRow key={run.id} run={run} />
                                ))}
                            </div>
                        </div>
                    ) : (
                        <p className="text-sm text-muted-foreground">A automação vai registrar runs assim que o trigger configurado receber um device_event compatível.</p>
                    )}
                </div>

                <div className="flex gap-2">
                    <Button
                        variant="outline"
                        disabled={isPending}
                        onClick={() => void updateAutomation({ automationId: automation.id, data: { enabled: !automation.enabled } })}
                    >
                        {automation.enabled ? "Pausar" : "Ativar"}
                    </Button>
                    <UpsertAutomationDialog automation={automation}>
                        <Button variant="secondary">Editar</Button>
                    </UpsertAutomationDialog>
                </div>
            </CardContent>
        </Card>
    )
}

function AutomationRunRow({ run }: { run: AutomationRun }) {
    const summary = runSummary(run)
    const event = eventFromSummary(summary)

    return (
        <article className="rounded-xl border bg-background px-3 py-3 text-xs">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <p className="font-medium">{new Date(run.createdAt).toLocaleString("pt-BR")}</p>
                    <p className="text-muted-foreground">
                        {numberFromSummary(summary, "successCount")} sucesso(s) • {numberFromSummary(summary, "errorCount")} erro(s)
                    </p>
                </div>
                <RunStatusBadge status={run.status} />
            </div>

            <div className="mt-3 space-y-1 text-muted-foreground">
                <p className="font-medium text-foreground">{stringValue(event?.title) || "Execução registrada"}</p>
                <p>{stringValue(event?.message) || stringValue(summary?.error) || "Scene disparada automaticamente a partir de um device_event."}</p>
            </div>
        </article>
    )
}

function triggerLabel(automation: Automation, deviceById: Map<number, Device>, entityById: Map<number, Entity>) {
    if (automation.trigger.type === "device_state_changed") {
        const device = automation.trigger.deviceId ? deviceById.get(automation.trigger.deviceId) : null
        return `Quando ${device?.name || `device #${automation.trigger.deviceId ?? "?"}`} mudar de estado`
    }

    const entity = automation.trigger.entityId ? entityById.get(automation.trigger.entityId) : null
    const device = entity ? deviceById.get(entity.deviceId) : null
    return `Quando ${entity?.name || `entidade #${automation.trigger.entityId ?? "?"}`} mudar de estado${device?.name ? ` em ${device.name}` : ""}`
}

function runSummary(run?: AutomationRun | null) {
    return run?.summary && typeof run.summary === "object" ? run.summary : null
}

function eventFromSummary(summary: Record<string, unknown> | null) {
    return summary?.event && typeof summary.event === "object" ? summary.event as Record<string, unknown> : null
}

function numberFromSummary(summary: Record<string, unknown> | null, key: string) {
    return typeof summary?.[key] === "number" ? Number(summary[key]) : 0
}

function stringValue(value: unknown) {
    return typeof value === "string" && value.trim() ? value : null
}

function RunStatusBadge({ status }: { status: AutomationRun["status"] }) {
    if (status === "success") {
        return (
            <Badge variant="outline" className="text-emerald-600 dark:text-emerald-400">
                <CircleCheckIcon className="size-3.5" />
                Sucesso
            </Badge>
        )
    }

    if (status === "partial") {
        return (
            <Badge variant="outline" className="text-amber-600 dark:text-amber-400">
                <CircleAlertIcon className="size-3.5" />
                Parcial
            </Badge>
        )
    }

    if (status === "error") {
        return (
            <Badge variant="outline" className="text-destructive">
                <CircleAlertIcon className="size-3.5" />
                Erro
            </Badge>
        )
    }

    return <Badge variant="outline">Pendente</Badge>
}