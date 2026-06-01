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

    return (
        <Card className="w-full">
            <CardHeader className="gap-4">
                <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                    <div>
                        <CardTitle>Histórico</CardTitle>
                        <CardDescription>Logs de comando e eventos recentes deste dispositivo.</CardDescription>
                    </div>
                    <Badge variant="outline">{items.length} item(ns)</Badge>
                </div>
            </CardHeader>

            <CardContent>
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
                ) : null}
            </CardContent>
        </Card>
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

    return (
        <div className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
            {items.map((item) => (
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
    )
}

function HistoryItemIcon({ item }: { item: DeviceHistoryEntry }) {
    if (item.kind === "command") {
        return <CommandIcon className="size-4" />
    }

    if (["device_linked_local", "linked_local", "auto_linked_local"].includes(String(item.eventType || ""))) {
        return <Link2Icon className="size-4" />
    }

    if (String(item.eventType || "") === "status_initialized") {
        return <SearchIcon className="size-4" />
    }

    if (String(item.eventType || "") === "became_online") {
        return <WifiIcon className="size-4" />
    }

    if (String(item.eventType || "") === "became_offline") {
        return <WifiOffIcon className="size-4" />
    }

    if (String(item.eventType || "") === "state_changed") {
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

    if (item.kind === "command") {
        const resultPayload = isRecord(item.result) && isRecord(item.result.result) ? item.result.result : null
        const params = isRecord(item.command) && isRecord(item.command.params) ? item.command.params : null

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

    if (item.kind === "event" && isRecord(item.payload)) {
        if (item.payload.ip) {
            parts.push(`IP ${String(item.payload.ip)}`)
        }

        if (item.payload.provider) {
            parts.push(String(item.payload.provider))
        }
    }

    return parts.length ? parts.join(" • ") : null
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