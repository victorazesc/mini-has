"use client"

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useCameraRecordings, useSendCommand } from "@/hooks/use-devices";
import { cameraObservationDescriptionPtBr, isLikelyEnglishCameraText } from "@/lib/camera-semantics";
import { cn } from "@/lib/utils";
import type { CameraRecording, Device } from "@/src/services/devices.service";
import { Activity, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CalendarDays, Camera, Car, Check, ChevronLeft, ChevronRight, Clock3, Copy, ExternalLink, Grid2X2, Maximize, PawPrint, Play, RefreshCw, ShieldAlert, Users, Video, VideoOff, ZoomIn, ZoomOut } from "lucide-react";
import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

export function CameraControl({ device, compact = false }: { device: Device; compact?: boolean }) {
    const [viewerOpen, setViewerOpen] = useState(false);
    const viewerRef = useRef<HTMLDivElement>(null);
    const isIOSBrowser = useIOSBrowser();
    const { mutate: sendCommand, isPending } = useSendCommand();
    const capabilities = device.capabilities;
    const payload = device.payload as unknown as Record<string, unknown>;
    const status = device.status as unknown as Record<string, unknown>;
    const rtspUrl = stringValue(capabilities.rtspUrl) || stringValue(payload.rtspUrl);
    const snapshotUrl = stringValue(capabilities.snapshotUrl) || stringValue(payload.snapshotUrl);
    const browserStreamUrl = stringValue(capabilities.hlsUrl) || stringValue(capabilities.webRtcUrl) || stringValue(capabilities.httpStreamUrl);
    const ip = stringValue(payload.ip) || hostFromUrl(rtspUrl);
    const authenticated = Boolean(status.authenticated ?? capabilities.authenticated);
    const streamAvailable = Boolean(status.streamAvailable ?? capabilities.streamAvailable);
    const ptzAvailable = Boolean(status.ptzAvailable ?? capabilities.ptzAvailable);
    const localStreamUrl = streamAvailable
        ? `/api/devices/${device.id}/stream.mjpeg`
        : "";
    const highQualityStreamUrl = streamAvailable
        ? `/api/devices/${device.id}/stream.${isIOSBrowser ? "mjpeg" : "mp4"}?quality=high`
        : "";
    const localPanelUrl = ip ? `http://${ip}` : "";

    const refresh = () => {
        sendCommand({
            deviceId: device.id,
            command: { command: "query", params: {} },
        });
    };

    const movePtz = (pan: number, tilt: number, zoom = 0) => {
        sendCommand({
            deviceId: device.id,
            command: { command: "ptz_move", params: { pan, tilt, zoom, durationMs: 350 } },
        });
    };

    const copyRtspUrl = async () => {
        if (!rtspUrl) return;
        try {
            await navigator.clipboard.writeText(rtspUrl);
            toast.success("URL RTSP copiada");
        } catch {
            toast.error("Não foi possível copiar a URL RTSP");
        }
    };

    const content = (
        <div className={cn("grid gap-5", compact ? "grid-cols-1" : "xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]")}>
            <div className="overflow-hidden rounded-2xl border bg-black">
                <div className="group relative flex aspect-video cursor-pointer items-center justify-center" onClick={() => setViewerOpen(true)}>
                    {!viewerOpen ? (
                        <CameraViewer deviceName={device.name} streamUrl={browserStreamUrl || localStreamUrl} snapshotUrl={snapshotUrl} />
                    ) : null}
                    {(browserStreamUrl || localStreamUrl || snapshotUrl) ? (
                        <Button aria-label="Abrir câmera em tela cheia" className="absolute right-3 top-3 opacity-80 transition-opacity group-hover:opacity-100" size="icon" variant="secondary">
                            <Maximize className="size-4" />
                        </Button>
                    ) : null}
                </div>
                <div className="flex items-center justify-between gap-3 border-t bg-background/80 px-4 py-3">
                    <span className="flex items-center gap-2 text-sm">
                        <span className={cn("size-2 rounded-full", streamAvailable ? "bg-red-500" : device.status.online ? "bg-amber-500" : "bg-muted-foreground")} />
                        {streamAvailable ? "Stream disponível" : device.status.online ? "Câmera online" : "Câmera offline"}
                    </span>
                    <span className="text-xs text-muted-foreground">{ip || "IP não informado"}</span>
                </div>
            </div>

            <div className="space-y-3">
                <CameraStatus label="Conexão local" value={device.status.online ? "Online" : "Offline"} active={device.status.online} />
                <CameraStatus label="Autenticação" value={authenticated ? "Validada" : "Pendente"} active={authenticated} />
                <CameraStatus label="Stream RTSP" value={streamAvailable ? "Validado" : "Não validado"} active={streamAvailable} />
                <CameraStatus label="Controle PTZ" value={ptzAvailable ? "Disponível" : "Não detectado"} active={ptzAvailable} />

                {ptzAvailable ? (
                    <div className="space-y-4 rounded-2xl border bg-black/20 p-4">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <p className="text-sm font-medium">Mover câmera</p>
                                <p className="mt-0.5 text-xs text-muted-foreground">Direção e aproximação</p>
                            </div>
                            <Camera className="size-4 text-muted-foreground" />
                        </div>

                        <div className="mx-auto grid size-56 grid-cols-3 grid-rows-3 place-items-center rounded-full border border-white/10 bg-[#242424] p-3 shadow-inner sm:size-60">
                            <span />
                            <PtzDirectionButton disabled={isPending} label="Mover para cima" onClick={() => movePtz(0, 0.65)}><ArrowUp /></PtzDirectionButton>
                            <span />
                            <PtzDirectionButton disabled={isPending} label="Mover para esquerda" onClick={() => movePtz(-0.65, 0)}><ArrowLeft /></PtzDirectionButton>
                            <span className="flex size-16 items-center justify-center rounded-full border border-white/10 bg-[#f2f2f2] text-black shadow-md">
                                <Camera className="size-6" />
                            </span>
                            <PtzDirectionButton disabled={isPending} label="Mover para direita" onClick={() => movePtz(0.65, 0)}><ArrowRight /></PtzDirectionButton>
                            <span />
                            <PtzDirectionButton disabled={isPending} label="Mover para baixo" onClick={() => movePtz(0, -0.65)}><ArrowDown /></PtzDirectionButton>
                            <span />
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                            <Button className="h-11 rounded-xl" disabled={isPending} onClick={() => movePtz(0, 0, 0.65)} variant="outline">
                                <ZoomIn className="size-4" /> Aproximar
                            </Button>
                            <Button className="h-11 rounded-xl" disabled={isPending} onClick={() => movePtz(0, 0, -0.65)} variant="outline">
                                <ZoomOut className="size-4" /> Afastar
                            </Button>
                        </div>
                    </div>
                ) : null}

                <div className="space-y-2 rounded-2xl border p-4">
                    <p className="text-xs text-muted-foreground">Endereço RTSP</p>
                    <p className="break-all font-mono text-xs">{rtspUrl || "Não informado"}</p>
                    <Button className="w-full" disabled={!rtspUrl} onClick={() => void copyRtspUrl()} size="sm" variant="outline">
                        <Copy className="size-4" /> Copiar URL RTSP
                    </Button>
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-1">
                    <Button disabled={isPending} onClick={refresh} variant="outline">
                        <RefreshCw className={cn("size-4", isPending && "animate-spin")} /> Atualizar conexão
                    </Button>
                    <Button disabled={!localPanelUrl} onClick={() => window.open(localPanelUrl, "_blank", "noopener,noreferrer")} variant="outline">
                        <ExternalLink className="size-4" /> Abrir painel local
                    </Button>
                </div>
            </div>
        </div>
    );

    const viewer = (
        <Dialog onOpenChange={setViewerOpen} open={viewerOpen}>
            <DialogContent className="h-dvh max-h-none w-screen max-w-none gap-3 rounded-none bg-black p-3 sm:max-w-none" ref={viewerRef}>
                <DialogHeader className="absolute left-4 top-4 z-10 rounded-xl bg-black/70 px-4 py-2 backdrop-blur">
                    <DialogTitle>{device.name} • alta qualidade</DialogTitle>
                </DialogHeader>
                <Button
                    aria-label="Usar tela cheia do navegador"
                    className="absolute right-16 top-4 z-10"
                    onClick={() => void viewerRef.current?.requestFullscreen()}
                    size="icon"
                    variant="secondary"
                >
                    <Maximize className="size-4" />
                </Button>
                <div className="flex h-full min-h-0 items-center justify-center overflow-hidden rounded-xl bg-black">
                    <CameraViewer deviceName={device.name} streamUrl={browserStreamUrl || highQualityStreamUrl} snapshotUrl={snapshotUrl} />
                </div>
            </DialogContent>
        </Dialog>
    );

    if (compact) return <>{content}{viewer}</>;

    return (
        <Card className="w-full border-zinc-800 bg-[#1f1f1f] shadow-none">
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base"><Camera className="size-5" /> Controle da câmera</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
                {content}
                <CameraTimeline deviceId={device.id} deviceName={device.name} />
            </CardContent>
            {viewer}
        </Card>
    );
}

function CameraTimeline({ deviceId, deviceName }: { deviceId: number; deviceName: string }) {
    const [date, setDate] = useState(today());
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [category, setCategory] = useState<RecordingCategory>("all");
    const [priority, setPriority] = useState<RecordingPriority>("all");
    const { data: recordings = [], isLoading, isError } = useCameraRecordings(deviceId, date);
    const selected = recordings.find((recording) => recording.id === selectedId) || null;
    const classifiedRecordings = useMemo(
        () => recordings.map((recording) => ({
            recording,
            categories: recordingCategories(recording),
            priority: recordingPriority(recording),
        })),
        [recordings],
    );
    const categoryCounts = useMemo(
        () => RECORDING_CATEGORIES.reduce<Record<RecordingCategory, number>>((counts, option) => {
            const inPriority = classifiedRecordings.filter(
                (item) => priority === "all" || item.priority === priority,
            );
            counts[option.value] = option.value === "all"
                ? inPriority.length
                : inPriority.filter((item) => item.categories.has(option.value)).length;
            return counts;
        }, { all: 0, people: 0, vehicles: 0, pets: 0, motion: 0 }),
        [classifiedRecordings, priority],
    );
    const priorityCounts = useMemo(() => {
        const inCategory = classifiedRecordings.filter(
            (item) => category === "all" || item.categories.has(category),
        );
        return {
            all: inCategory.length,
            attention: inCategory.filter((item) => item.priority === "attention").length,
            normal: inCategory.filter((item) => item.priority === "normal").length,
            unclassified: inCategory.filter((item) => item.priority === "unclassified").length,
        };
    }, [category, classifiedRecordings]);
    const filteredRecordings = useMemo(
        () => classifiedRecordings
            .filter((item) => category === "all" || item.categories.has(category))
            .filter((item) => priority === "all" || item.priority === priority)
            .map((item) => item.recording),
        [category, classifiedRecordings, priority],
    );
    const timelineItems = useMemo<Array<
        | { kind: "recording"; recording: CameraRecording }
        | { kind: "hidden"; count: number; key: string }
    >>(() => {
        const visibleIds = new Set(filteredRecordings.map((recording) => recording.id));
        const items: Array<
            | { kind: "recording"; recording: CameraRecording }
            | { kind: "hidden"; count: number; key: string }
        > = [];
        let hiddenCount = 0;
        let hiddenGroup = 0;
        for (const recording of recordings) {
            if (!visibleIds.has(recording.id)) {
                hiddenCount += 1;
                continue;
            }
            if (hiddenCount) {
                items.push({ kind: "hidden", count: hiddenCount, key: `hidden-${hiddenGroup}` });
                hiddenCount = 0;
                hiddenGroup += 1;
            }
            items.push({ kind: "recording", recording });
        }
        if (hiddenCount) items.push({ kind: "hidden", count: hiddenCount, key: `hidden-${hiddenGroup}` });
        return items;
    }, [filteredRecordings, recordings]);
    const hasActiveFilters = category !== "all" || priority !== "all";

    const clearFilters = () => {
        setCategory("all");
        setPriority("all");
        setSelectedId(null);
    };

    const changeDate = (offset: number) => {
        setDate(shiftDate(date, offset));
        clearFilters();
    };

    return (
        <div className="rounded-2xl border border-zinc-800 bg-black/20 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <p className="flex items-center gap-2 font-medium"><CalendarDays className="size-4" /> Eventos gravados</p>
                    <p className="mt-1 text-xs text-muted-foreground">Movimento local com 5s anteriores e 5s posteriores.</p>
                </div>
                <div className="flex items-center rounded-xl border bg-background/60">
                    <Button aria-label="Dia anterior" onClick={() => changeDate(-1)} size="icon" variant="ghost"><ChevronLeft className="size-4" /></Button>
                    <span className="min-w-28 px-2 text-center text-sm font-medium">{formatDay(date)}</span>
                    <Button aria-label="Próximo dia" disabled={date >= today()} onClick={() => changeDate(1)} size="icon" variant="ghost"><ChevronRight className="size-4" /></Button>
                </div>
            </div>

            {recordings.length ? (
                <div className="mt-5 rounded-2xl border border-zinc-800 bg-background/30 p-3 sm:p-4">
                    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(380px,auto)]">
                        <div className="min-w-0">
                            <p className="mb-2 text-xs font-medium text-muted-foreground">Tipo de evento</p>
                            <div className="-mx-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                                <div aria-label="Filtrar por tipo de evento" className="flex flex-wrap gap-2 sm:min-w-max sm:flex-nowrap" role="group">
                                    {RECORDING_CATEGORIES.map((option) => (
                                        <RecordingFilterChip
                                            active={category === option.value}
                                            count={categoryCounts[option.value]}
                                            icon={option.icon}
                                            key={option.value}
                                            label={option.label}
                                            onClick={() => {
                                                setCategory(option.value);
                                                setSelectedId(null);
                                            }}
                                        />
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className="min-w-0">
                            <p className="mb-2 text-xs font-medium text-muted-foreground">Relevância</p>
                            <div aria-label="Filtrar por relevância" className="grid grid-cols-2 gap-1 rounded-xl bg-black/25 p-1 sm:grid-cols-4" role="group">
                                {RECORDING_PRIORITIES.map((option) => (
                                    <RecordingPriorityChip
                                        active={priority === option.value}
                                        count={priorityCounts[option.value]}
                                        key={option.value}
                                        label={option.label}
                                        onClick={() => {
                                            setPriority(option.value);
                                            setSelectedId(null);
                                        }}
                                    />
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="mt-3 flex min-h-8 flex-wrap items-center justify-between gap-2 border-t border-zinc-800 pt-3">
                        <p aria-live="polite" className="text-xs text-muted-foreground">
                            {eventCountLabel(filteredRecordings.length)}
                            {hasActiveFilters ? ` de ${recordings.length} no dia` : " no dia"}
                        </p>
                        {hasActiveFilters ? (
                            <Button className="h-8 px-3 text-xs" onClick={clearFilters} size="sm" variant="ghost">
                                Limpar filtros
                            </Button>
                        ) : null}
                    </div>
                </div>
            ) : null}

            {isLoading ? <p className="py-8 text-center text-sm text-muted-foreground">Carregando eventos...</p> : null}
            {isError ? <p className="py-8 text-center text-sm text-destructive">Não foi possível carregar os eventos.</p> : null}
            {!isLoading && !isError && !recordings.length ? (
                <div className="mt-5 flex flex-col items-center gap-2 rounded-xl border border-dashed py-8 text-center text-muted-foreground">
                    <Video className="size-6" />
                    <p className="text-sm">Nenhum movimento gravado neste dia.</p>
                </div>
            ) : null}

            {!isLoading && !isError && recordings.length && !filteredRecordings.length ? (
                <div className="mt-5 flex flex-col items-center gap-3 rounded-xl border border-dashed py-8 text-center text-muted-foreground">
                    <Activity className="size-6" />
                    <div>
                        <p className="text-sm font-medium text-foreground">Nenhum evento com esses filtros</p>
                        <p className="mt-1 text-xs">Tente outra categoria ou relevância.</p>
                    </div>
                    <Button onClick={clearFilters} size="sm" variant="outline">Limpar filtros</Button>
                </div>
            ) : null}

            {timelineItems.length ? (
                <div className="relative mt-5 space-y-3 border-l border-amber-400/30 pl-5">
                    {timelineItems.map((item) => item.kind === "hidden" ? (
                        <button
                            className="flex w-full items-center justify-between gap-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-left text-sm text-amber-100"
                            key={item.key}
                            onClick={clearFilters}
                            type="button"
                        >
                            <span>{eventCountLabel(item.count)} ocultos pelos filtros nesta parte da linha do tempo.</span>
                            <span className="shrink-0 font-medium">Mostrar todos</span>
                        </button>
                    ) : (
                        <button
                            className="group relative grid w-full gap-3 overflow-hidden rounded-xl border bg-background/50 p-3 text-left transition-colors hover:border-amber-400/50 hover:bg-background sm:grid-cols-[160px_1fr_auto]"
                            key={item.recording.id}
                            onClick={() => setSelectedId(item.recording.id)}
                            type="button"
                        >
                            <span className="absolute -left-[25px] top-6 size-2 rounded-full bg-amber-400 ring-4 ring-background" />
                            <div className="flex aspect-video items-center justify-center overflow-hidden rounded-lg bg-black">
                                {item.recording.hasThumbnail ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img alt={`Movimento em ${deviceName}`} className="h-full w-full object-cover transition-transform group-hover:scale-105" src={`/api/devices/${deviceId}/recordings/${item.recording.id}/thumbnail`} />
                                ) : <Camera className="size-6 text-muted-foreground" />}
                            </div>
                            <div className="self-center">
                                <div className="flex flex-wrap items-center gap-2">
                                    <p className="font-medium">{recordingDescription(item.recording) || "Movimento detectado"}</p>
                                    <RecordingAttentionBadge recording={item.recording} />
                                </div>
                                <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground"><Clock3 className="size-3.5" /> {formatTime(item.recording.motionStartedAt)} · {formatDuration(item.recording.durationSeconds)}</p>
                                <p className="mt-1 text-xs text-muted-foreground">Início da gravação: {formatTime(item.recording.startedAt)}</p>
                            </div>
                            <span className="self-center rounded-full bg-amber-400/15 p-3 text-amber-300"><Play className="size-4 fill-current" /></span>
                        </button>
                    ))}
                </div>
            ) : null}

            <Dialog onOpenChange={(open) => !open && setSelectedId(null)} open={Boolean(selected)}>
                <DialogContent className="max-w-5xl bg-black p-3">
                    <DialogHeader className="px-2 pt-1">
                        <DialogTitle>{deviceName} · movimento às {selected ? formatTime(selected.motionStartedAt) : ""}</DialogTitle>
                    </DialogHeader>
                    {selected ? (
                        <>
                            <video autoPlay className="max-h-[75vh] w-full rounded-xl bg-black" controls muted playsInline preload="auto" src={`/api/devices/${deviceId}/recordings/${selected.id}/video`} />
                            <p className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-zinc-200">
                                {recordingDescription(selected) || "Movimento detectado diante da câmera."}
                            </p>
                            <RecordingAttentionDetails recording={selected} />
                        </>
                    ) : null}
                </DialogContent>
            </Dialog>
        </div>
    );
}

type RecordingCategory = "all" | "people" | "vehicles" | "pets" | "motion";
type RecordingPriority = "all" | "attention" | "normal" | "unclassified";
type RecordingPriorityValue = Exclude<RecordingPriority, "all">;

const RECORDING_CATEGORIES = [
    { value: "all", label: "Tudo", icon: Grid2X2 },
    { value: "people", label: "Pessoas", icon: Users },
    { value: "vehicles", label: "Veículos", icon: Car },
    { value: "pets", label: "Pets", icon: PawPrint },
    { value: "motion", label: "Movimento", icon: Activity },
] as const;

const RECORDING_PRIORITIES = [
    { value: "all", label: "Todas" },
    { value: "attention", label: "Atenção" },
    { value: "normal", label: "Comuns" },
    { value: "unclassified", label: "Sem análise" },
] as const;

function RecordingFilterChip({
    active,
    count,
    icon: Icon,
    label,
    onClick,
}: {
    active: boolean;
    count: number;
    icon: typeof Activity;
    label: string;
    onClick: () => void;
}) {
    return (
        <button
            aria-pressed={active}
            className={cn(
                "inline-flex h-11 shrink-0 items-center gap-2 rounded-xl border px-3 text-sm font-medium transition-colors sm:h-9",
                active
                    ? "border-amber-400/50 bg-amber-400/15 text-amber-200"
                    : "border-zinc-800 bg-black/20 text-muted-foreground hover:bg-white/5 hover:text-foreground",
            )}
            onClick={onClick}
            type="button"
        >
            <Icon className="size-4" />
            <span>{label}</span>
            <span className={cn(
                "min-w-5 rounded-full px-1.5 py-0.5 text-center text-[10px] tabular-nums",
                active ? "bg-amber-300/15 text-amber-100" : "bg-white/5",
            )}>
                {count}
            </span>
        </button>
    );
}

function RecordingPriorityChip({
    active,
    count,
    label,
    onClick,
}: {
    active: boolean;
    count: number;
    label: string;
    onClick: () => void;
}) {
    return (
        <button
            aria-pressed={active}
            className={cn(
                "flex min-h-11 min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-medium transition-colors sm:min-h-9",
                active
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
            )}
            onClick={onClick}
            type="button"
        >
            <span className="truncate">{label}</span>
            <span className={cn(
                "rounded-full px-1.5 py-0.5 text-[10px] tabular-nums",
                active ? "bg-amber-400/15 text-amber-200" : "bg-white/5",
            )}>
                {count}
            </span>
        </button>
    );
}

function CameraViewer({ deviceName, snapshotUrl, streamUrl }: { deviceName: string; snapshotUrl: string; streamUrl: string }) {
    if (streamUrl) {
        if (streamUrl.includes("stream.mjpeg")) {
            // eslint-disable-next-line @next/next/no-img-element
            return <img alt={`Vídeo ao vivo de ${deviceName}`} className="h-full w-full object-contain" src={streamUrl} />;
        }
        return <video autoPlay className="h-full w-full object-contain" controls muted playsInline src={streamUrl} />;
    }
    if (snapshotUrl) {
        // eslint-disable-next-line @next/next/no-img-element
        return <img alt={`Imagem de ${deviceName}`} className="h-full w-full object-contain" src={snapshotUrl} />;
    }
    return (
        <div className="flex max-w-md flex-col items-center gap-3 px-6 text-center text-muted-foreground">
            <VideoOff className="size-12" />
            <div>
                <p className="font-medium text-foreground">Visualização indisponível no navegador</p>
                <p className="mt-1 text-sm">A câmera foi encontrada via RTSP. Para vídeo ao vivo, configure um stream HLS ou WebRTC.</p>
            </div>
        </div>
    );
}

function useIOSBrowser(): boolean {
    return useSyncExternalStore(
        subscribeBrowserEnvironment,
        iosBrowserSnapshot,
        serverBrowserSnapshot,
    );
}

function subscribeBrowserEnvironment(): () => void {
    return () => undefined;
}

function iosBrowserSnapshot(): boolean {
    return /iPad|iPhone|iPod/i.test(navigator.userAgent)
        || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function serverBrowserSnapshot(): boolean {
    return false;
}

function PtzDirectionButton({ children, disabled, label, onClick }: { children: React.ReactNode; disabled: boolean; label: string; onClick: () => void }) {
    return (
        <Button
            aria-label={label}
            className="size-14 rounded-full border-white/10 bg-black/20 text-white shadow-none hover:bg-white/10 sm:size-16 [&_svg]:size-6"
            disabled={disabled}
            onClick={onClick}
            size="icon"
            variant="outline"
        >
            {children}
        </Button>
    );
}

function CameraStatus({ label, value, active }: { label: string; value: string; active: boolean }) {
    return (
        <div className={cn("flex items-center justify-between gap-3 rounded-2xl border p-4", active ? "border-emerald-500/40 bg-emerald-500/10" : "bg-secondary/20")}>
            <div>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="mt-1 font-medium">{value}</p>
            </div>
            <span className={cn("flex size-9 items-center justify-center rounded-full", active ? "bg-emerald-500/20 text-emerald-400" : "bg-secondary text-muted-foreground")}>
                {active ? <Check className="size-4" /> : <Video className="size-4" />}
            </span>
        </div>
    );
}

function stringValue(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function recordingDescription(recording: CameraRecording): string {
    const status = stringValue(recording.metadata.classificationStatus);
    const semantic = objectValue(recording.metadata.semantic);
    const analyzer = objectValue(semantic?.analyzer);
    const localSemantic = stringValue(analyzer?.name) === "local-vehicle-event"
        ? semantic
        : objectValue(recording.metadata.localSemantic);
    const rawLocalDescription = stringValue(localSemantic?.description);
    const localDescription = isLikelyEnglishCameraText(rawLocalDescription) ? "" : rawLocalDescription;
    if (status === "semantic_pending") {
        return localDescription
            ? `${localDescription} Análise detalhada em andamento.`
            : "Movimento gravado. Análise detalhada em andamento.";
    }
    if (status === "semantic_deferred") {
        return localDescription
            ? `${localDescription} Análise detalhada aguardando disponibilidade.`
            : "Movimento gravado. Análise detalhada aguardando disponibilidade.";
    }
    if (status === "semantic_failed") {
        return localDescription
            ? `${localDescription} Análise detalhada indisponível.`
            : "Movimento gravado. Não foi possível concluir a análise detalhada.";
    }
    if (status === "local_unconfirmed" || stringValue(analyzer?.name) === "local-vehicle-event") {
        return localDescription || "Movimento gravado. A descrição detalhada não foi confirmada.";
    }
    const direct = stringValue(recording.metadata.description);
    if (direct && !isLikelyEnglishCameraText(direct)) return direct;
    const semanticDescription = stringValue(semantic?.description);
    if (semanticDescription && !isLikelyEnglishCameraText(semanticDescription)) return semanticDescription;
    const structuredDescription = cameraObservationDescriptionPtBr(semantic);
    if (structuredDescription) return structuredDescription;
    return localDescription;
}

type RecordingAttention = {
    label: string;
    level: "pending" | "unavailable" | "none" | "low" | "medium" | "high" | "critical";
    confidence?: number;
    reasons: string[];
};

function RecordingAttentionBadge({ recording }: { recording: CameraRecording }) {
    const attention = recordingAttention(recording);
    if (!attention) return null;
    return (
        <span className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
            attention.level === "pending" && "border-sky-400/30 bg-sky-400/10 text-sky-300",
            attention.level === "unavailable" && "border-zinc-400/30 bg-zinc-400/10 text-zinc-300",
            ["none", "low"].includes(attention.level) && "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
            attention.level === "medium" && "border-amber-400/30 bg-amber-400/10 text-amber-300",
            attention.level === "high" && "border-orange-400/30 bg-orange-400/10 text-orange-300",
            attention.level === "critical" && "border-red-400/40 bg-red-400/15 text-red-300",
        )}>
            <ShieldAlert className="size-3" /> {attention.label}
        </span>
    );
}

function RecordingAttentionDetails({ recording }: { recording: CameraRecording }) {
    const attention = recordingAttention(recording);
    if (!attention || (!attention.reasons.length && attention.confidence === undefined)) return null;
    return (
        <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-zinc-200">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{attention.label}</span>
                {attention.confidence !== undefined ? (
                    <span className="text-xs text-zinc-400">Confiança: {Math.round(attention.confidence * 100)}%</span>
                ) : null}
            </div>
            {attention.reasons.length ? (
                <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-zinc-400">
                    {attention.reasons.slice(0, 4).map((reason) => <li key={reason}>{reason}</li>)}
                </ul>
            ) : null}
        </div>
    );
}

function recordingAttention(recording: CameraRecording): RecordingAttention | null {
    const status = stringValue(recording.metadata.classificationStatus);
    if (status === "semantic_pending") {
        return { label: "Analisando vídeo", level: "pending", reasons: [] };
    }
    if (status === "semantic_deferred") {
        return { label: "Aguardando análise", level: "unavailable", reasons: [] };
    }
    if (status === "semantic_failed") {
        return { label: "Sem análise detalhada", level: "unavailable", reasons: [] };
    }
    if (status === "local_unconfirmed") {
        return { label: "Sem análise detalhada", level: "unavailable", reasons: [] };
    }
    const semantic = objectValue(recording.metadata.semantic);
    const analyzer = objectValue(semantic?.analyzer);
    if (stringValue(analyzer?.name) === "local-vehicle-event") {
        return { label: "Sem análise detalhada", level: "unavailable", reasons: [] };
    }
    const risk = objectValue(semantic?.risk);
    const level = stringValue(risk?.level);
    if (!["none", "low", "medium", "high", "critical"].includes(level)) return null;
    const labels: Record<Exclude<RecordingAttention["level"], "pending" | "unavailable">, string> = {
        none: "Evento comum",
        low: "Baixa atenção",
        medium: "Atenção média",
        high: "Atenção alta",
        critical: "Atenção crítica",
    };
    const confidence = typeof semantic?.confidence === "number" && Number.isFinite(semantic.confidence)
        ? Math.min(1, Math.max(0, semantic.confidence))
        : undefined;
    const reasons = Array.isArray(risk?.reasons)
        ? risk.reasons
            .map((reason) => stringValue(reason))
            .filter((reason) => reason && !isLikelyEnglishCameraText(reason))
        : [];
    return {
        label: labels[level as Exclude<RecordingAttention["level"], "pending" | "unavailable">],
        level: level as Exclude<RecordingAttention["level"], "pending" | "unavailable">,
        confidence,
        reasons,
    };
}

function recordingCategories(recording: CameraRecording): Set<RecordingCategory> {
    const categories = new Set<RecordingCategory>();
    const metadata = recording.metadata;
    const semantic = objectValue(metadata.semantic);
    const semantics = [
        semantic,
        objectValue(metadata.localSemantic),
    ].filter((value): value is Record<string, unknown> => Boolean(value));
    const facts = semantics.flatMap((semantic) => stringArray(semantic.facts));
    const observations = semantics.flatMap((semantic) => objectArray(semantic.observations));
    const objects = objectArray(metadata.objects);
    const tokens = new Set([
        ...facts,
        ...observations.flatMap((observation) => [
            stringValue(observation.subject),
            stringValue(observation.kind),
            stringValue(observation.class),
        ]),
        ...objects.flatMap((object) => [
            stringValue(object.label),
            stringValue(object.class),
        ]),
    ].map((value) => value.toLowerCase()).filter(Boolean));

    if (hasToken(tokens, ["person", "pedestrian", "cyclist", "motorcyclist", "person_present", "person_passed", "person_detected", "cyclist_passed", "cyclist_maneuvered", "cyclist_wheelie", "cyclist_fell", "motorcyclist_passed", "motorcyclist_maneuvered", "motorcyclist_fell"])) {
        categories.add("people");
    }
    if (hasToken(tokens, ["vehicle", "car", "truck", "bus", "motorcycle", "motorcyclist", "bicycle", "cyclist", "vehicle_detected", "vehicle_passed", "vehicle_stopped", "vehicle_maneuvered", "cyclist_passed", "cyclist_maneuvered", "cyclist_wheelie", "cyclist_fell", "motorcyclist_passed", "motorcyclist_maneuvered", "motorcyclist_fell"])) {
        categories.add("vehicles");
    }
    if (hasToken(tokens, ["animal", "dog", "cat", "pet", "animal_detected", "animal_present"])) {
        categories.add("pets");
    }
    if (!categories.size) categories.add("motion");
    return categories;
}

function recordingPriority(recording: CameraRecording): RecordingPriorityValue {
    const attention = recordingAttention(recording);
    if (!attention || ["pending", "unavailable"].includes(attention.level)) return "unclassified";
    return ["medium", "high", "critical"].includes(attention.level) ? "attention" : "normal";
}

function hasToken(tokens: Set<string>, candidates: string[]): boolean {
    return candidates.some((candidate) => tokens.has(candidate));
}

function stringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.map(stringValue).filter(Boolean) : [];
}

function objectArray(value: unknown): Array<Record<string, unknown>> {
    return Array.isArray(value)
        ? value.map(objectValue).filter((item): item is Record<string, unknown> => Boolean(item))
        : [];
}

function eventCountLabel(count: number): string {
    return `${count} ${count === 1 ? "evento" : "eventos"}`;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;
}

function hostFromUrl(value: string): string {
    try {
        return value ? new URL(value).hostname : "";
    } catch {
        return "";
    }
}

function today(): string {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    return now.toISOString().slice(0, 10);
}

function shiftDate(value: string, days: number): string {
    const date = new Date(`${value}T12:00:00`);
    date.setDate(date.getDate() + days);
    return date.toISOString().slice(0, 10);
}

function formatDay(value: string): string {
    return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" }).format(new Date(`${value}T12:00:00`));
}

function formatTime(value: string): string {
    return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value));
}

function formatDuration(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return minutes ? `${minutes}min ${remainder}s` : `${remainder}s`;
}
