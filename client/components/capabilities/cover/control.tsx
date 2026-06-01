"use client"

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useSendCommand } from "@/hooks/use-devices";
import { cn } from "@/lib/utils";
import { Device } from "@/src/services/devices.service";
import { ArrowDown, ArrowUp, Blinds, Pause, Save, StepBack, StepForward } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

export function CoverControl({ device }: { device: Device }) {
    const { mutate: sendCommand, isPending } = useSendCommand();
    const currentPosition = coverPosition(device);
    const firmwareState = coverFirmwareState(device);
    const positionRef = useRef(currentPosition);
    const [maxStepsInput, setMaxStepsInput] = useState<string | null>(null);
    const displayedMaxSteps = maxStepsInput ?? maxStepsValue(firmwareState.maxSteps);

    useEffect(() => {
        positionRef.current = currentPosition;
    }, [currentPosition]);

    const statusLabel = useMemo(() => {
        const state = String(device.status?.state || "").toLowerCase();
        if (state === "open") return "Aberta";
        if (state === "closed") return "Fechada";
        if (state === "opening") return "Abrindo";
        if (state === "closing") return "Fechando";
        return "Parada";
    }, [device.status?.state]);

    const sendCoverCommand = (command: string, params: Record<string, unknown> = {}) => {
        sendCommand({
            deviceId: device.id,
            command: {
                command,
                params,
            },
        });
    };

    return (
        <Card className="w-full max-w-[720px] border-zinc-800 bg-[#1f1f1f] shadow-none">
            <CardHeader className="flex flex-row items-center justify-between">
                <div>
                    <CardTitle className="text-base">Persiana</CardTitle>
                    <p className="text-sm text-muted-foreground">{statusLabel} • {currentPosition}% fechado</p>
                </div>
                <div className={cn(
                    "flex size-12 items-center justify-center rounded-full",
                    currentPosition < 100 ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground"
                )}>
                    <Blinds className="size-6" />
                </div>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="grid grid-cols-3 gap-3">
                    <Button variant="outline" disabled={isPending} onClick={() => sendCoverCommand("open")}>
                        <ArrowUp className="size-4" />
                        Abrir
                    </Button>
                    <Button variant="outline" disabled={isPending} onClick={() => sendCoverCommand("stop")}>
                        <Pause className="size-4" />
                        Parar
                    </Button>
                    <Button variant="outline" disabled={isPending} onClick={() => sendCoverCommand("close")}>
                        <ArrowDown className="size-4" />
                        Fechar
                    </Button>
                </div>

                <div className="space-y-3">
                    <div className="flex items-center justify-between text-sm text-muted-foreground">
                        <span>Aberta</span>
                        <span>Fechada</span>
                    </div>
                    <input
                        type="range"
                        key={`${device.id}-${currentPosition}`}
                        min={0}
                        max={100}
                        step={1}
                        defaultValue={currentPosition}
                        disabled={isPending}
                        className="h-2 w-full cursor-pointer accent-primary"
                        onChange={(event) => {
                            positionRef.current = Number(event.target.value);
                        }}
                        onPointerUp={() => sendCoverCommand("set_position", { position: positionRef.current })}
                        onKeyUp={(event) => {
                            if (event.key === "Enter") sendCoverCommand("set_position", { position: positionRef.current });
                        }}
                    />
                </div>

                <div className="grid grid-cols-3 gap-3">
                    <Button variant="secondary" disabled={isPending} onClick={() => sendCoverCommand("jog_open")}>
                        <StepBack className="size-4" />
                        Jog abrir
                    </Button>
                    <Button variant="secondary" disabled={isPending} onClick={() => sendCoverCommand("jog_stop")}>
                        <Pause className="size-4" />
                        Jog parar
                    </Button>
                    <Button variant="secondary" disabled={isPending} onClick={() => sendCoverCommand("jog_close")}>
                        <StepForward className="size-4" />
                        Jog fechar
                    </Button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <Button variant="outline" disabled={isPending} onClick={() => sendCoverCommand("calibrate_open")}>
                        <Save className="size-4" />
                        Salvar aberto
                    </Button>
                    <Button variant="outline" disabled={isPending} onClick={() => sendCoverCommand("calibrate_closed")}>
                        <Save className="size-4" />
                        Salvar fechado
                    </Button>
                    <Button variant="outline" disabled={isPending} onClick={() => sendCoverCommand("calibrate_zero")}>
                        <Save className="size-4" />
                        Zerar encoder
                    </Button>
                    <div className="flex gap-2">
                        <Input
                            type="number"
                            min={1}
                            placeholder="maxSteps"
                            disabled={isPending}
                            value={displayedMaxSteps}
                            onChange={(event) => {
                                setMaxStepsInput(event.target.value);
                            }}
                        />
                        <Button
                            variant="outline"
                            disabled={isPending}
                            onClick={() => {
                                const maxSteps = Number(displayedMaxSteps);
                                if (Number.isFinite(maxSteps) && maxSteps > 0) {
                                    sendCoverCommand("calibrate_max_steps", { maxSteps });
                                }
                            }}
                        >
                            Aplicar
                        </Button>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>Alvo: {firmwareState.targetPosition ?? "-"}%</span>
                    <span>Movendo: {firmwareState.moving ? "sim" : "nao"}</span>
                    <span>Calibrada: {firmwareState.calibrated ? "sim" : "nao"}</span>
                    <span>PWM: {firmwareState.pwm ?? "-"}</span>
                </div>
            </CardContent>
        </Card>
    );
}

function coverPosition(device: Device): number {
    const status = device.status as Device["status"] & { position?: unknown };
    const rawPosition = status.position ?? nested(status.raw, "state", "position") ?? status.dps?.position ?? status.dps?.["1"];
    const position = Number(rawPosition);
    if (Number.isFinite(position)) return Math.max(0, Math.min(100, Math.round(position)));
    const state = String(device.status?.state || "").toLowerCase();
    if (state === "open") return 0;
    if (state === "closed" || state === "off") return 100;
    return 0;
}

function coverFirmwareState(device: Device) {
    const state = nested(device.status?.raw, "state") as Record<string, unknown> | undefined;
    const maxSteps = Number(state?.encoderTicksOpenApplied);

    return {
        targetPosition: numberOrNull(state?.targetPosition),
        moving: Boolean(state?.moving),
        calibrated: Boolean(state?.calibrated),
        pwm: numberOrNull(state?.pwm),
        maxSteps: Number.isFinite(maxSteps) && maxSteps > 0 ? maxSteps : null,
    };
}

function numberOrNull(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function maxStepsValue(value: number | null): string {
    return value ? String(value) : "";
}

function nested(value: unknown, ...keys: string[]): unknown {
    let current = value;
    for (const key of keys) {
        if (!current || typeof current !== "object") return undefined;
        current = (current as Record<string, unknown>)[key];
    }
    return current;
}
