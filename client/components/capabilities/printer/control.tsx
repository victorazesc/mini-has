"use client"

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSendCommand } from "@/hooks/use-devices";
import { cn } from "@/lib/utils";
import type { Device } from "@/src/services/devices.service";
import { ExternalLink, Pause, Play, Printer, RefreshCw, Thermometer, XCircle } from "lucide-react";

export function PrinterControl({ device, compact = false }: { device: Device; compact?: boolean }) {
    const { mutate: sendCommand, isPending } = useSendCommand();
    const status = device.status as unknown as Record<string, unknown>;
    const payload = device.payload as unknown as Record<string, unknown>;
    const state = stringValue(status.state);
    const printState = stringValue(status.printState);
    const filename = stringValue(status.filename);
    const progress = Math.max(0, Math.min(1, numberValue(status.progress)));
    const mainsailUrl = stringValue(status.mainsailUrl) || stringValue(payload.baseUrl) || `http://${stringValue(payload.ip)}`;
    const isPrinting = printState === "printing";
    const isPaused = printState === "paused";

    const command = (name: string) => sendCommand({
        deviceId: device.id,
        command: { command: name, params: {} },
    });

    const content = (
        <div className="space-y-4">
            <div className="rounded-2xl border bg-secondary/20 p-4">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <p className="text-xs text-muted-foreground">Estado da impressora</p>
                        <p className={cn("mt-1 text-xl font-semibold", state === "error" ? "text-destructive" : device.status.online ? "text-emerald-500" : "text-muted-foreground")}>
                            {printerStateLabel(state)}
                        </p>
                        <p className="mt-1 break-all text-sm text-muted-foreground">{filename || "Nenhum arquivo em impressão"}</p>
                    </div>
                    <Printer className="size-8 text-muted-foreground" />
                </div>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-secondary">
                    <div className="h-full bg-emerald-500 transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
                </div>
                <p className="mt-2 text-right text-xs text-muted-foreground">{Math.round(progress * 100)}%</p>
            </div>

            <div className="grid grid-cols-2 gap-2">
                <Temperature label="Extrusor" temperature={numberValue(status.extruderTemperature)} target={numberValue(status.extruderTarget)} />
                <Temperature label="Mesa" temperature={numberValue(status.bedTemperature)} target={numberValue(status.bedTarget)} />
            </div>

            <div className="grid grid-cols-2 gap-2">
                <Button disabled={isPending || !isPrinting} onClick={() => command("pause")} variant="outline">
                    <Pause className="size-4" /> Pausar
                </Button>
                <Button disabled={isPending || !isPaused} onClick={() => command("resume")} variant="outline">
                    <Play className="size-4" /> Retomar
                </Button>
                <Button disabled={isPending || (!isPrinting && !isPaused)} onClick={() => {
                    if (window.confirm("Cancelar a impressão atual?")) command("cancel");
                }} variant="destructive">
                    <XCircle className="size-4" /> Cancelar
                </Button>
                <Button disabled={isPending} onClick={() => command("query")} variant="outline">
                    <RefreshCw className={cn("size-4", isPending && "animate-spin")} /> Atualizar
                </Button>
            </div>

            <Button className="w-full" disabled={!mainsailUrl} onClick={() => window.open(mainsailUrl, "_blank", "noopener,noreferrer")} variant="outline">
                <ExternalLink className="size-4" /> Abrir Mainsail
            </Button>
        </div>
    );

    if (compact) return content;

    return (
        <Card className="w-full border-zinc-800 bg-[#1f1f1f] shadow-none">
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base"><Printer className="size-5" /> Impressora 3D</CardTitle>
            </CardHeader>
            <CardContent>{content}</CardContent>
        </Card>
    );
}

function Temperature({ label, temperature, target }: { label: string; temperature: number; target: number }) {
    return (
        <div className="rounded-xl border bg-secondary/20 p-3">
            <p className="flex items-center gap-1 text-xs text-muted-foreground"><Thermometer className="size-3.5" /> {label}</p>
            <p className="mt-1 font-medium">{temperature.toFixed(1)}°C</p>
            <p className="text-xs text-muted-foreground">Alvo: {target.toFixed(1)}°C</p>
        </div>
    );
}

function printerStateLabel(state: string): string {
    if (state === "printing") return "Imprimindo";
    if (state === "paused") return "Pausada";
    if (state === "complete") return "Concluída";
    if (state === "error") return "Erro no Klipper";
    if (state === "offline") return "Offline";
    if (state === "standby") return "Em espera";
    return state || "Estado desconhecido";
}

function stringValue(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}
