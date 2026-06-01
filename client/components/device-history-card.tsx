"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { DeviceHistoryEntry } from "@/src/services/devices.service"
import { CircleCheckIcon, Clock3Icon, CommandIcon, Link2Icon, PowerIcon, SearchIcon, TriangleAlertIcon, WifiIcon, WifiOffIcon } from "lucide-react"

const historyDateFormatter = new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
})

const importantEventTypes = new Set([
    "became_offline",
    "entity_became_offline",
    "state_changed",
    "entity_state_changed",
])

export function DeviceHistoryCard({
    items,
    isLoading,
    isError,
    onRetry,
}: {
    items: DeviceHistoryEntry[]
    isLoading: boolean
    isError: boolean
    onRetry: () => void
}) {
    const eventItems = items.filter((item) => item.kind === "event")
    const commandItems = items.filter((item) => item.kind === "command")
    const highlightedItems = items.filter(isImportantHistoryItem).slice(0, 4)

    return (
        <Card className="w-full">
            <CardHeader className="gap-4">
                <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                    <div>
                        <CardTitle>Histórico e eventos</CardTitle>
                        <CardDescription>Timeline do dispositivo principal e das entidades/capabilities vinculadas.</CardDescription>
                    </div>
                    <Badge variant="outline">{items.length} item(ns)</Badge>
                </div>
            </CardHeader>

            <CardContent className="space-y-5">
                {isLoading ? <HistorySkeleton /> : null}

                {!isLoading && isError ? (
                    <div className="flex flex-col items-start gap-3 rounded-3xl border border-destructive/30 bg-destructive/5 p-4">
                        <div>
                            <p className="font-medium text-destructive">Erro ao carregar histórico</p>
                            <p className="text-sm text-muted-foreground">Tente buscar novamente os logs e eventos deste dispositivo.</p>
                        </div>
                        <Button variant="outline" size="sm" onClick={onRetry}>Tentar novamente</Button>
                    </div>
                ) : null}

                {!isLoading && !isError ? (
                    <>
                        {highlightedItems.length ? <HighlightedHistory items={highlightedItems} /> : null}

                        <Tabs defaultValue="all" className="gap-4">
                            <TabsList>
                                <TabsTrigger value="all">Tudo <Badge variant="secondary">{items.length}</Badge></TabsTrigger>
                                <TabsTrigger value="events">Eventos <Badge variant="secondary">{eventItems.length}</Badge></TabsTrigger>
                                <TabsTrigger value="commands">Comandos <Badge variant="secondary">{commandItems.length}</Badge></TabsTrigger>
                            </TabsList>

                            <TabsContent value="all">
                                <HistoryList items={items} emptyText="Nenhum evento ou comando registrado ainda." />
                            </TabsContent>
                            <TabsContent value="events">
                                <HistoryList items={eventItems} emptyText="Nenhum evento registrado ainda." />
                            </TabsContent>
                            <TabsContent value="commands">
                                <HistoryList items={commandItems} emptyText="Nenhum comando registrado ainda." />
                            </TabsContent>
                        </Tabs>
                    </>
                ) : null}
            </CardContent>
        </Card>
    )
}

function HighlightedHistory({ items }: { items: DeviceHistoryEntry[] }) {
    return (
        <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <h3 className="text-sm font-medium">Em destaque</h3>
                    <p className="text-xs text-muted-foreground">Mudanças de estado, erros e eventos que pedem atenção.</p>
                </div>
                <Badge variant="outline">{items.length}</Badge>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
                {items.map((item) => (
                    <article
                        key={`highlight-${item.id}`}
                        className={cn(
                            "rounded-3xl border p-4",
                            highlightCardClasses(item.level)
                        )}
                    >
                        <div className="flex items-start gap-3">
                            <div className={cn("mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full", toneClasses(item.level))}>
                                <HistoryItemIcon item={item} />
                            </div>
                            <div className="min-w-0 flex-1 space-y-1.5">
                                <div className="flex flex-wrap items-center gap-2">
                                    <h4 className="font-medium leading-none">{item.title}</h4>
                                    {sourceBadge(item) ? <Badge variant="secondary">{sourceBadge(item)}</Badge> : null}
                                </div>
                                {item.message ? <p className="text-sm text-muted-foreground">{item.message}</p> : null}
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <Clock3Icon className="size-3.5" />
                                    <time dateTime={item.createdAt}>{historyDateFormatter.format(new Date(item.createdAt))}</time>
                                </div>
                            </div>
                        </div>
                    </article>
                ))}
            </div>
        </section>
    )
}

function HistoryList({ items, emptyText }: { items: DeviceHistoryEntry[]; emptyText: string }) {
    if (!items.length) {
        return (
            <div className="rounded-3xl border border-dashed p-6 text-sm text-muted-foreground">
                {emptyText}
            </div>
        )
    }

    const groups = groupHistoryItems(items)

    return (
        <div className="max-h-130 space-y-5 overflow-y-auto pr-1">
            {groups.map((group) => (
                <section key={group.label} className="space-y-3">
                    <div className="flex items-center gap-2">
                        <h3 className="text-sm font-medium">{group.label}</h3>
                        <Badge variant="outline">{group.items.length}</Badge>
                    </div>

                    <div className="space-y-3">
                        {group.items.map((item) => (
                            <article key={item.id} className="rounded-3xl border bg-card/60 p-4">
                                <div className="flex items-start gap-3">
                                    <div className={cn("mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full", toneClasses(item.level))}>
                                        <HistoryItemIcon item={item} />
                                    </div>

                                    <div className="min-w-0 flex-1 space-y-2">
                                        <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                                            <div className="space-y-2">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <h3 className="font-medium leading-none">{item.title}</h3>
                                                    <Badge variant="outline">{item.kind === "command" ? "Comando" : "Evento"}</Badge>
                                                    {sourceBadge(item) ? <Badge variant="secondary">{sourceBadge(item)}</Badge> : null}
                                                    {item.status ? (
                                                        <Badge variant="outline" className={commandStatusClasses(item.status)}>
                                                            {commandStatusLabel(item.status)}
                                                        </Badge>
                                                    ) : null}
                                                </div>
                                                {item.message ? <p className="text-sm text-muted-foreground">{item.message}</p> : null}
                                                {historyMeta(item) ? (
                                                    <p className="text-xs text-muted-foreground/90">{historyMeta(item)}</p>
                                                ) : null}
                                            </div>

                                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                                <Clock3Icon className="size-3.5" />
                                                <time dateTime={item.createdAt}>{historyDateFormatter.format(new Date(item.createdAt))}</time>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </article>
                        ))}
                    </div>
                </section>
            ))}
        </div>
    )
}

function HistoryItemIcon({ item }: { item: DeviceHistoryEntry }) {
    if (item.kind === "command") {
        return <CommandIcon className="size-4" />
    }

    if (["device_linked_local", "linked_local", "auto_linked_local"].includes(String(item.eventType || ""))) {
        return <Link2Icon className="size-4" />
    }

    if (["status_initialized", "entity_status_initialized"].includes(String(item.eventType || ""))) {
        return <SearchIcon className="size-4" />
    }

    if (["became_online", "entity_became_online"].includes(String(item.eventType || ""))) {
        return <WifiIcon className="size-4" />
    }

    if (["became_offline", "entity_became_offline"].includes(String(item.eventType || ""))) {
        return <WifiOffIcon className="size-4" />
    }

    if (["state_changed", "entity_state_changed"].includes(String(item.eventType || ""))) {
        return <PowerIcon className="size-4" />
    }

    if (item.level === "error" || item.level === "warning") {
        return <TriangleAlertIcon className="size-4" />
    }

    return <CircleCheckIcon className="size-4" />
}

function toneClasses(level: DeviceHistoryEntry["level"]) {
    if (level === "error") return "bg-destructive/10 text-destructive"
    if (level === "warning") return "bg-amber-500/10 text-amber-600 dark:text-amber-400"
    if (level === "success") return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
    return "bg-secondary text-muted-foreground"
}

function highlightCardClasses(level: DeviceHistoryEntry["level"]) {
    if (level === "error") return "border-destructive/30 bg-destructive/5"
    if (level === "warning") return "border-amber-500/30 bg-amber-500/5"
    if (level === "success") return "border-emerald-500/25 bg-emerald-500/5"
    return "border-border bg-muted/30"
}

function commandStatusClasses(status: string) {
    const normalized = String(status || "").toLowerCase()
    if (["error", "failed", "failure", "unsupported"].includes(normalized)) return "text-destructive"
    if (["ok", "sent", "accepted"].includes(normalized)) return "text-emerald-600 dark:text-emerald-400"
    return "text-muted-foreground"
}

function commandStatusLabel(status: string) {
    const normalized = String(status || "").toLowerCase()
    if (normalized === "ok") return "OK"
    if (normalized === "sent") return "Enviado"
    if (normalized === "accepted") return "Aceito"
    if (normalized === "error") return "Erro"
    if (normalized === "unsupported") return "Não suportado"
    return status
}

function historyMeta(item: DeviceHistoryEntry) {
    const parts: string[] = []
    const payload = isRecord(item.payload) ? item.payload : null
    const scene = historySceneSource(item)

    if (item.kind === "command") {
        const resultPayload = isRecord(item.result) && isRecord(item.result.result) ? item.result.result : null
        const params = isRecord(item.command) && isRecord(item.command.params) ? item.command.params : null

        if (scene?.sceneName) {
            parts.push(`Cena ${String(scene.sceneName)}`)
        } else if (scene?.sceneId) {
            parts.push(`Cena #${String(scene.sceneId)}`)
        }

        if (payload?.scope === "entity" && payload.entityName) {
            parts.push(String(payload.entityName))
        }

        if (resultPayload?.provider) {
            parts.push(String(resultPayload.provider))
        }

        if (resultPayload?.transport) {
            parts.push(String(resultPayload.transport))
        }

        if (params) {
            const summary = Object.entries(params)
                .filter(([, value]) => value !== undefined && value !== null && value !== "")
                .slice(0, 2)
                .map(([key, value]) => `${key}: ${formatInlineValue(value)}`)
                .join(" • ")

            if (summary) {
                parts.push(summary)
            }
        }
    }

    if (item.kind === "event" && payload) {
        if (payload.entityName) {
            parts.push(String(payload.entityName))
        }

        if (payload.entityType) {
            parts.push(String(payload.entityType))
        }

        if (payload.ip) {
            parts.push(`IP ${String(payload.ip)}`)
        }

        if (payload.provider) {
            parts.push(String(payload.provider))
        }
    }

    return parts.length ? parts.join(" • ") : null
}

function sourceBadge(item: DeviceHistoryEntry) {
    if (historySceneSource(item)) return "Cena"
    const payload = isRecord(item.payload) ? item.payload : null
    if (payload?.scope === "entity") return "Entidade"
    if (payload?.scope === "device") return "Principal"
    if (item.kind === "command") return "Principal"
    return null
}

function historySceneSource(item: DeviceHistoryEntry) {
    const payload = isRecord(item.payload) ? item.payload : null
    if (payload?.sourceType === "scene" || payload?.sceneName || payload?.sceneId) return payload

    const command = isRecord(item.command) ? item.command : null
    if (isRecord(command?.source) && (command.source.type === "scene" || command.source.sceneName || command.source.sceneId)) {
        return command.source
    }

    const resultPayload = isRecord(item.result) && isRecord(item.result.result) ? item.result.result : null
    if (isRecord(resultPayload?.source) && (resultPayload.source.type === "scene" || resultPayload.source.sceneName || resultPayload.source.sceneId)) {
        return resultPayload.source
    }

    if (isRecord(resultPayload?.scene)) {
        return resultPayload.scene
    }

    return null
}

function isImportantHistoryItem(item: DeviceHistoryEntry) {
    const normalizedStatus = String(item.status || "").toLowerCase()
    if (item.level === "error" || item.level === "warning") return true
    if (["error", "failed", "failure", "unsupported"].includes(normalizedStatus)) return true
    return importantEventTypes.has(String(item.eventType || ""))
}

function groupHistoryItems(items: DeviceHistoryEntry[]) {
    const now = new Date()
    const todayStart = startOfDay(now)
    const yesterdayStart = new Date(todayStart)
    yesterdayStart.setDate(todayStart.getDate() - 1)

    const groups = {
        today: [] as DeviceHistoryEntry[],
        yesterday: [] as DeviceHistoryEntry[],
        older: [] as DeviceHistoryEntry[],
    }

    for (const item of items) {
        const itemDate = new Date(item.createdAt)
        if (itemDate >= todayStart) {
            groups.today.push(item)
            continue
        }

        if (itemDate >= yesterdayStart) {
            groups.yesterday.push(item)
            continue
        }

        groups.older.push(item)
    }

    return [
        { label: "Hoje", items: groups.today },
        { label: "Ontem", items: groups.yesterday },
        { label: "Mais antigo", items: groups.older },
    ].filter((group) => group.items.length > 0)
}

function startOfDay(value: Date) {
    const date = new Date(value)
    date.setHours(0, 0, 0, 0)
    return date
}

function formatInlineValue(value: unknown) {
    if (typeof value === "string") return value
    if (typeof value === "number" || typeof value === "boolean") return String(value)
    return JSON.stringify(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function HistorySkeleton() {
    return (
        <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="rounded-3xl border p-4">
                    <div className="flex items-start gap-3">
                        <Skeleton className="size-9 rounded-full" />
                        <div className="w-full space-y-2">
                            <Skeleton className="h-4 w-2/5" />
                            <Skeleton className="h-3 w-4/5" />
                            <Skeleton className="h-3 w-3/5" />
                        </div>
                    </div>
                </div>
            ))}
        </div>
    )
}