"use client"

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useCameraRecordings, useSendCommand } from "@/hooks/use-devices";
import { cn } from "@/lib/utils";
import type { CameraRecording, Device } from "@/src/services/devices.service";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CalendarDays, Camera, Check, ChevronLeft, ChevronRight, Clock3, Copy, ExternalLink, Maximize, Play, RefreshCw, Video, VideoOff, ZoomIn, ZoomOut } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

export function CameraControl({ device, compact = false }: { device: Device; compact?: boolean }) {
    const [viewerOpen, setViewerOpen] = useState(false);
    const viewerRef = useRef<HTMLDivElement>(null);
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
    const localStreamUrl = streamAvailable ? `/api/devices/${device.id}/stream.mp4` : "";
    const highQualityStreamUrl = streamAvailable ? `/api/devices/${device.id}/stream.mp4?quality=high` : "";
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
                    <CameraViewer deviceName={device.name} streamUrl={browserStreamUrl || localStreamUrl} snapshotUrl={snapshotUrl} />
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
    const [selected, setSelected] = useState<CameraRecording | null>(null);
    const { data: recordings = [], isLoading, isError } = useCameraRecordings(deviceId, date);

    return (
        <div className="rounded-2xl border border-zinc-800 bg-black/20 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <p className="flex items-center gap-2 font-medium"><CalendarDays className="size-4" /> Eventos gravados</p>
                    <p className="mt-1 text-xs text-muted-foreground">Movimento local com 5s anteriores e 5s posteriores.</p>
                </div>
                <div className="flex items-center rounded-xl border bg-background/60">
                    <Button aria-label="Dia anterior" onClick={() => setDate(shiftDate(date, -1))} size="icon" variant="ghost"><ChevronLeft className="size-4" /></Button>
                    <span className="min-w-28 px-2 text-center text-sm font-medium">{formatDay(date)}</span>
                    <Button aria-label="Próximo dia" disabled={date >= today()} onClick={() => setDate(shiftDate(date, 1))} size="icon" variant="ghost"><ChevronRight className="size-4" /></Button>
                </div>
            </div>

            {isLoading ? <p className="py-8 text-center text-sm text-muted-foreground">Carregando eventos...</p> : null}
            {isError ? <p className="py-8 text-center text-sm text-destructive">Não foi possível carregar os eventos.</p> : null}
            {!isLoading && !isError && !recordings.length ? (
                <div className="mt-5 flex flex-col items-center gap-2 rounded-xl border border-dashed py-8 text-center text-muted-foreground">
                    <Video className="size-6" />
                    <p className="text-sm">Nenhum movimento gravado neste dia.</p>
                </div>
            ) : null}

            {recordings.length ? (
                <div className="relative mt-5 space-y-3 border-l border-amber-400/30 pl-5">
                    {recordings.map((recording) => (
                        <button
                            className="group relative grid w-full gap-3 overflow-hidden rounded-xl border bg-background/50 p-3 text-left transition-colors hover:border-amber-400/50 hover:bg-background sm:grid-cols-[160px_1fr_auto]"
                            key={recording.id}
                            onClick={() => setSelected(recording)}
                            type="button"
                        >
                            <span className="absolute -left-[25px] top-6 size-2 rounded-full bg-amber-400 ring-4 ring-background" />
                            <div className="flex aspect-video items-center justify-center overflow-hidden rounded-lg bg-black">
                                {recording.hasThumbnail ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img alt={`Movimento em ${deviceName}`} className="h-full w-full object-cover transition-transform group-hover:scale-105" src={`/api/devices/${deviceId}/recordings/${recording.id}/thumbnail`} />
                                ) : <Camera className="size-6 text-muted-foreground" />}
                            </div>
                            <div className="self-center">
                                <p className="font-medium">Movimento detectado</p>
                                <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground"><Clock3 className="size-3.5" /> {formatTime(recording.motionStartedAt)} · {formatDuration(recording.durationSeconds)}</p>
                                <p className="mt-1 text-xs text-muted-foreground">Início da gravação: {formatTime(recording.startedAt)}</p>
                            </div>
                            <span className="self-center rounded-full bg-amber-400/15 p-3 text-amber-300"><Play className="size-4 fill-current" /></span>
                        </button>
                    ))}
                </div>
            ) : null}

            <Dialog onOpenChange={(open) => !open && setSelected(null)} open={Boolean(selected)}>
                <DialogContent className="max-w-5xl bg-black p-3">
                    <DialogHeader className="px-2 pt-1">
                        <DialogTitle>{deviceName} · movimento às {selected ? formatTime(selected.motionStartedAt) : ""}</DialogTitle>
                    </DialogHeader>
                    {selected ? <video autoPlay className="max-h-[75vh] w-full rounded-xl bg-black" controls muted playsInline preload="auto" src={`/api/devices/${deviceId}/recordings/${selected.id}/video`} /> : null}
                </DialogContent>
            </Dialog>
        </div>
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
