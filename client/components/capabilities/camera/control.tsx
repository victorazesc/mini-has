"use client"

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSendCommand } from "@/hooks/use-devices";
import { cn } from "@/lib/utils";
import type { Device } from "@/src/services/devices.service";
import { Camera, Check, Copy, ExternalLink, RefreshCw, Video, VideoOff } from "lucide-react";
import { toast } from "sonner";

export function CameraControl({ device, compact = false }: { device: Device; compact?: boolean }) {
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
    const localStreamUrl = streamAvailable ? `/api/devices/${device.id}/stream.mjpeg` : "";
    const localPanelUrl = ip ? `http://${ip}` : "";

    const refresh = () => {
        sendCommand({
            deviceId: device.id,
            command: { command: "query", params: {} },
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
                <div className="flex aspect-video items-center justify-center">
                    {browserStreamUrl ? (
                        <video autoPlay className="h-full w-full object-contain" controls muted playsInline src={browserStreamUrl} />
                    ) : localStreamUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img alt={`Vídeo ao vivo de ${device.name}`} className="h-full w-full object-contain" src={localStreamUrl} />
                    ) : snapshotUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img alt={`Imagem de ${device.name}`} className="h-full w-full object-contain" src={snapshotUrl} />
                    ) : (
                        <div className="flex max-w-md flex-col items-center gap-3 px-6 text-center text-muted-foreground">
                            <VideoOff className="size-12" />
                            <div>
                                <p className="font-medium text-foreground">Visualização indisponível no navegador</p>
                                <p className="mt-1 text-sm">A câmera foi encontrada via RTSP. Para vídeo ao vivo, configure um stream HLS ou WebRTC.</p>
                            </div>
                        </div>
                    )}
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

    if (compact) return content;

    return (
        <Card className="w-full border-zinc-800 bg-[#1f1f1f] shadow-none">
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base"><Camera className="size-5" /> Controle da câmera</CardTitle>
            </CardHeader>
            <CardContent>{content}</CardContent>
        </Card>
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
