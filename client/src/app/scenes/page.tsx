"use client"

import { UpsertSceneDialog } from "@/components/upsert-scene-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useRunScene, useSceneRuns, useScenes } from "@/hooks/use-scenes"
import { Scene, SceneRun } from "@/src/services/scenes.service"
import { CircleAlertIcon, CircleCheckIcon, Loader2Icon, PlusCircleIcon, PlayIcon } from "lucide-react"
import { useMemo } from "react"

export default function ScenesPage() {
    const { data: scenes = [], isLoading, isError } = useScenes()

    return (
        <main className="flex flex-1 flex-col gap-4 px-4 lg:px-6">
            <section className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-semibold">Scenes</h1>
                    <p className="text-sm text-muted-foreground">Agrupe comandos manuais em execuções reutilizáveis.</p>
                </div>
                <UpsertSceneDialog>
                    <Button variant="outline">
                        <PlusCircleIcon className="size-4" />
                        Nova cena
                    </Button>
                </UpsertSceneDialog>
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
                    <CardContent className="py-8 text-sm text-destructive">Erro ao carregar cenas.</CardContent>
                </Card>
            ) : null}

            {!isLoading && !isError && scenes.length === 0 ? (
                <Card>
                    <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
                        <PlayIcon className="size-10 text-muted-foreground" />
                        <div>
                            <p className="font-medium">Nenhuma cena criada</p>
                            <p className="text-sm text-muted-foreground">Monte sequências manuais para executar vários comandos com um clique.</p>
                        </div>
                    </CardContent>
                </Card>
            ) : null}

            <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                {scenes.map((scene) => (
                    <SceneCard key={scene.id} scene={scene} />
                ))}
            </section>
        </main>
    )
}

function SceneCard({ scene }: { scene: Scene }) {
    const { data: runs = [] } = useSceneRuns(scene.id, 1)
    const { mutateAsync: runScene, isPending } = useRunScene()

    const latestRun = runs[0]
    const summary = useMemo(() => latestRun ? latestRun.summary : null, [latestRun])
    const steps = Array.isArray(summary?.steps) ? summary.steps : []

    return (
        <Card>
            <CardHeader className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <CardTitle>{scene.name}</CardTitle>
                        <p className="text-sm text-muted-foreground">{scene.description || "Sem descrição"}</p>
                    </div>
                    <Badge variant="outline">{scene.actions.length} ação(ões)</Badge>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="secondary">{scene.roomName || "Sem cômodo"}</Badge>
                    <span>Atualizada em {new Date(scene.updatedAt).toLocaleString("pt-BR")}</span>
                </div>
            </CardHeader>

            <CardContent className="space-y-4">
                <div className="space-y-2">
                    {scene.actions.map((action) => (
                        <div key={action.id} className="flex items-center justify-between rounded-xl border px-3 py-2 text-sm">
                            <div>
                                <p className="font-medium">{action.orderIndex}. {action.deviceName || `Device ${action.deviceId}`}</p>
                                <p className="text-xs text-muted-foreground">{labelForCommand(action.command, action.params)}</p>
                            </div>
                            <Badge variant="outline">{action.deviceType || "device"}</Badge>
                        </div>
                    ))}
                </div>

                <div className="rounded-2xl border bg-secondary/20 p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                            <p className="text-sm font-medium">Última execução</p>
                            <p className="text-xs text-muted-foreground">
                                {latestRun ? new Date(latestRun.createdAt).toLocaleString("pt-BR") : "Ainda não executada"}
                            </p>
                        </div>
                        {latestRun ? <RunStatusBadge status={latestRun.status} /> : <Badge variant="outline">Sem runs</Badge>}
                    </div>

                    {latestRun ? (
                        <div className="space-y-2 text-sm">
                            <p className="text-muted-foreground">
                                {(summary?.successCount as number | undefined) ?? 0} sucesso(s) • {(summary?.errorCount as number | undefined) ?? 0} erro(s)
                            </p>
                            {steps.slice(0, 3).map((step, index) => {
                                const stepRecord = typeof step === "object" && step !== null ? step as Record<string, unknown> : {}
                                return (
                                    <div key={`${scene.id}-${index}`} className="flex items-center justify-between gap-3 rounded-xl border bg-background px-3 py-2 text-xs">
                                        <div>
                                            <p className="font-medium">{String(stepRecord.deviceName || stepRecord.deviceId || `Ação ${index + 1}`)}</p>
                                            <p className="text-muted-foreground">{String(stepRecord.message || stepRecord.command || "Execução registrada")}</p>
                                        </div>
                                        <RunStatusBadge status={String(stepRecord.status || "pending") as SceneRun["status"]} />
                                    </div>
                                )
                            })}
                        </div>
                    ) : null}
                </div>

                <div className="flex gap-2">
                    <Button variant="outline" disabled={isPending} onClick={() => void runScene(scene.id)}>
                        {isPending ? <Loader2Icon className="size-4 animate-spin" /> : <PlayIcon className="size-4" />}
                        Executar
                    </Button>
                    <UpsertSceneDialog scene={scene}>
                        <Button variant="secondary">Editar</Button>
                    </UpsertSceneDialog>
                </div>
            </CardContent>
        </Card>
    )
}

function RunStatusBadge({ status }: { status: SceneRun["status"] }) {
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

function labelForCommand(command: string, params: Record<string, unknown>) {
    if (command === "turn_on") return "Ligar"
    if (command === "turn_off") return "Desligar"
    if (command === "open") return "Abrir"
    if (command === "close") return "Fechar"
    if (command === "stop") return "Parar"
    if (command === "set_position") return `Ir para ${String(params.position ?? 0)}%`
    return command
}