"use client"

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useSendCommand } from "@/hooks/use-devices";
import { cn } from "@/lib/utils";
import { Device } from "@/src/services/devices.service";
import { AlertTriangle, ArrowDown, ArrowUp, Blinds, CheckCircle2, Pause, Save, StepBack, StepForward } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

type CalibrationStep = "idle" | "move_open" | "opening" | "open_stopped" | "move_closed" | "closing" | "closed_stopped" | "complete";

type CommandFeedback = {
    kind: "success" | "error";
    message: string;
};

export function CoverControl({ device }: { device: Device }) {
    const { mutate: sendCommand, isPending } = useSendCommand();
    const { mutate: sendEmergencyStopCommand, isPending: isEmergencyStopPending } = useSendCommand();
    const currentPosition = coverPosition(device);
    const firmwareState = coverFirmwareState(device);
    const positionRef = useRef(currentPosition ?? 0);
    const [maxStepsInput, setMaxStepsInput] = useState<string | null>(null);
    const displayedMaxSteps = maxStepsInput ?? maxStepsValue(firmwareState.maxSteps);
    const [calibrationStep, setCalibrationStep] = useState<CalibrationStep>("idle");
    const [feedback, setFeedback] = useState<CommandFeedback | null>(null);
    const online = device.status?.online !== false;
    const calibrationActive = calibrationStep !== "idle";
    const positionUnavailable = currentPosition === null
        || !firmwareState.calibrated
        || firmwareState.positionKnown === false;

    useEffect(() => {
        if (currentPosition !== null) positionRef.current = currentPosition;
    }, [currentPosition]);

    const statusLabel = useMemo(() => {
        if (currentPosition === null || firmwareState.positionKnown === false) return "Posição desconhecida";
        const state = String(device.status?.state || "").toLowerCase();
        if (state === "open") return "Aberta";
        if (state === "closed") return "Fechada";
        if (state === "opening") return "Abrindo";
        if (state === "closing") return "Fechando";
        return "Parada";
    }, [currentPosition, device.status?.state, firmwareState.positionKnown]);

    const sendCoverCommand = (
        command: string,
        params: Record<string, unknown> = {},
        successMessage?: string,
        onSuccess?: () => void,
    ) => {
        setFeedback(null);
        sendCommand({
            deviceId: device.id,
            command: {
                command,
                params,
            },
        }, {
            onSuccess: () => {
                if (successMessage) {
                    setFeedback({ kind: "success", message: successMessage });
                    toast.success(successMessage);
                }
                onSuccess?.();
            },
            onError: (error) => {
                setFeedback({ kind: "error", message: error.message });
            },
        });
    };

    const stopMotorImmediately = () => {
        setFeedback(null);
        sendEmergencyStopCommand({
            deviceId: device.id,
            command: {
                command: "jog_stop",
                params: {},
            },
        }, {
            onSuccess: () => {
                const message = "Motor parado e estado confirmado.";
                setFeedback({ kind: "success", message });
                toast.success(message);
                if (calibrationStep === "opening") setCalibrationStep("open_stopped");
                if (calibrationStep === "closing") setCalibrationStep("closed_stopped");
            },
            onError: (error) => {
                setFeedback({ kind: "error", message: error.message });
            },
        });
    };

    const normalControlDisabled = isPending || !online || calibrationActive || positionUnavailable;
    const calibrationControlDisabled = isPending || !online;

    return (
        <Card className="w-full max-w-[720px] border-zinc-800 bg-[#1f1f1f] shadow-none">
            <CardHeader className="flex flex-row items-center justify-between">
                <div>
                    <CardTitle className="text-base">Persiana</CardTitle>
                    <p className="text-sm text-muted-foreground">
                        {currentPosition === null ? "Posição desconhecida" : `${statusLabel} • ${currentPosition}% fechado`}
                    </p>
                </div>
                <div className={cn(
                    "flex size-12 items-center justify-center rounded-full",
                    currentPosition !== null && currentPosition < 100 ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground"
                )}>
                    <Blinds className="size-6" />
                </div>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="grid grid-cols-3 gap-3">
                    <Button variant="outline" disabled={normalControlDisabled || firmwareState.moving} onClick={() => sendCoverCommand("open", {}, "Comando para abrir confirmado.")}>
                        <ArrowUp className="size-4" />
                        Abrir
                    </Button>
                    <Button variant="outline" disabled={normalControlDisabled || !firmwareState.moving} onClick={() => sendCoverCommand("stop", {}, "Persiana parada.")}>
                        <Pause className="size-4" />
                        Parar
                    </Button>
                    <Button variant="outline" disabled={normalControlDisabled || firmwareState.moving} onClick={() => sendCoverCommand("close", {}, "Comando para fechar confirmado.")}>
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
                        key={`${device.id}-${currentPosition ?? "unknown"}`}
                        min={0}
                        max={100}
                        step={1}
                        defaultValue={currentPosition ?? 0}
                        disabled={normalControlDisabled || firmwareState.moving}
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

                {feedback && (
                    <div className={cn(
                        "rounded-xl border px-4 py-3 text-sm",
                        feedback.kind === "success"
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                            : "border-destructive/40 bg-destructive/10 text-destructive",
                    )}>
                        {feedback.message}
                    </div>
                )}

                {positionUnavailable && !calibrationActive && (
                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                        <p className="flex items-start gap-2 font-medium">
                            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                            Posição ainda não calibrada ou não confiável.
                        </p>
                        <p className="mt-1 text-xs text-amber-200/80">
                            Os controles normais ficam bloqueados para proteger o motor. Inicie a calibração guiada abaixo.
                        </p>
                    </div>
                )}

                <div className="rounded-2xl border border-zinc-800 bg-black/15 p-4">
                    <div className="mb-4 flex items-start justify-between gap-4">
                        <div>
                            <h3 className="text-sm font-semibold">Calibração guiada</h3>
                            <p className="mt-1 text-xs text-muted-foreground">
                                Use o jog até cada batente, pare o motor e só então salve a posição.
                            </p>
                        </div>
                        {firmwareState.calibrated && (
                            <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-1 text-xs text-emerald-300">
                                <CheckCircle2 className="size-3.5" />
                                Calibrada
                            </span>
                        )}
                    </div>

                    <CalibrationProgress step={calibrationStep} />

                    {(firmwareState.moving || (calibrationActive && calibrationStep !== "complete")) && (
                        <Button
                            className="mt-4 w-full"
                            variant="destructive"
                            disabled={isEmergencyStopPending}
                            onClick={stopMotorImmediately}
                        >
                            <Pause className="size-4" />
                            Parar motor agora
                        </Button>
                    )}

                    {calibrationStep === "idle" && (
                        <Button
                            className="mt-4 w-full"
                            disabled={calibrationControlDisabled || firmwareState.moving}
                            onClick={() => {
                                setFeedback(null);
                                setCalibrationStep("move_open");
                            }}
                        >
                            Iniciar calibração
                        </Button>
                    )}

                    {calibrationStep === "move_open" && (
                        <div className="mt-4 space-y-3">
                            <p className="text-sm">Leve a persiana até ficar totalmente aberta.</p>
                            <Button
                                className="w-full"
                                disabled={calibrationControlDisabled || firmwareState.moving}
                                onClick={() => {
                                    setCalibrationStep("opening");
                                    sendCoverCommand("jog_open", {}, "Movimento de abertura confirmado.");
                                }}
                            >
                                <StepBack className="size-4" />
                                Jog para abrir
                            </Button>
                        </div>
                    )}

                    {calibrationStep === "opening" && (
                        <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 p-3">
                            <p className="text-sm">Quando chegar no batente totalmente aberto, use “Parar motor agora”.</p>
                        </div>
                    )}

                    {calibrationStep === "open_stopped" && (
                        <div className="mt-4 grid gap-2 sm:grid-cols-2">
                            <Button
                                variant="secondary"
                                disabled={calibrationControlDisabled || firmwareState.moving}
                                onClick={() => {
                                    setCalibrationStep("opening");
                                    sendCoverCommand("jog_open", {}, "Ajuste de abertura confirmado.");
                                }}
                            >
                                <StepBack className="size-4" />
                                Ajustar mais
                            </Button>
                            <Button
                                disabled={calibrationControlDisabled || firmwareState.moving}
                                onClick={() => sendCoverCommand("calibrate_open", {}, "Posição totalmente aberta salva.", () => setCalibrationStep("move_closed"))}
                            >
                                <Save className="size-4" />
                                Salvar aberto
                            </Button>
                        </div>
                    )}

                    {calibrationStep === "move_closed" && (
                        <div className="mt-4 space-y-3">
                            <p className="text-sm">Agora leve a persiana até ficar totalmente fechada.</p>
                            <Button
                                className="w-full"
                                disabled={calibrationControlDisabled || firmwareState.moving}
                                onClick={() => {
                                    setCalibrationStep("closing");
                                    sendCoverCommand("jog_close", {}, "Movimento de fechamento confirmado.");
                                }}
                            >
                                <StepForward className="size-4" />
                                Jog para fechar
                            </Button>
                        </div>
                    )}

                    {calibrationStep === "closing" && (
                        <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 p-3">
                            <p className="text-sm">Quando chegar no batente totalmente fechado, use “Parar motor agora”.</p>
                        </div>
                    )}

                    {calibrationStep === "closed_stopped" && (
                        <div className="mt-4 grid gap-2 sm:grid-cols-2">
                            <Button
                                variant="secondary"
                                disabled={calibrationControlDisabled || firmwareState.moving}
                                onClick={() => {
                                    setCalibrationStep("closing");
                                    sendCoverCommand("jog_close", {}, "Ajuste de fechamento confirmado.");
                                }}
                            >
                                <StepForward className="size-4" />
                                Ajustar mais
                            </Button>
                            <Button
                                disabled={calibrationControlDisabled || firmwareState.moving}
                                onClick={() => sendCoverCommand("calibrate_closed", {}, "Calibração concluída e confirmada.", () => setCalibrationStep("complete"))}
                            >
                                <Save className="size-4" />
                                Salvar fechado
                            </Button>
                        </div>
                    )}

                    {calibrationStep === "complete" && (
                        <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
                            <p className="flex items-center gap-2 text-sm font-medium text-emerald-200">
                                <CheckCircle2 className="size-4" />
                                Calibração concluída.
                            </p>
                            <Button className="mt-3 w-full" variant="outline" onClick={() => setCalibrationStep("idle")}>
                                Concluir
                            </Button>
                        </div>
                    )}

                    {calibrationActive && calibrationStep !== "complete" && (
                        <Button
                            className="mt-3 w-full"
                            variant="ghost"
                            disabled={isPending || firmwareState.moving}
                            onClick={() => {
                                setCalibrationStep("idle");
                                setFeedback(null);
                            }}
                        >
                            Cancelar calibração
                        </Button>
                    )}
                </div>

                <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-xl border border-zinc-800 px-4 py-3 text-xs text-muted-foreground sm:grid-cols-4">
                    <span>Alvo: {firmwareState.targetPosition ?? "-"}%</span>
                    <span>Movendo: {firmwareState.moving ? "sim" : "nao"}</span>
                    <span>Calibrada: {firmwareState.calibrated ? "sim" : "nao"}</span>
                    <span>PWM: {firmwareState.pwm ?? "-"}</span>
                    <span>Encoder bruto: {firmwareState.rawEncoderTicks ?? "-"}</span>
                    <span>Encoder normalizado: {firmwareState.normalizedEncoderTicks ?? "-"}</span>
                    <span>Curso: {firmwareState.maxSteps ?? "-"} ticks</span>
                    <span>Movimento: {firmwareState.motionDirection ?? "-"}</span>
                    <span>Estado calibração: {firmwareState.calibrationState ?? "-"}</span>
                    <span>Posição conhecida: {firmwareState.positionKnown === null ? "-" : firmwareState.positionKnown ? "sim" : "nao"}</span>
                    <span>Posição confiável: {firmwareState.positionTrusted === null ? "-" : firmwareState.positionTrusted ? "sim" : "nao"}</span>
                    <span>Sinal encoder: {firmwareState.encoderDirectionSign ?? "-"}</span>
                </div>

                <details className="rounded-xl border border-zinc-800 px-4 py-3">
                    <summary className="cursor-pointer text-sm text-muted-foreground">Opções avançadas</summary>
                    <div className="mt-4 space-y-3">
                        <p className="flex gap-2 text-xs text-amber-300">
                            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                            Use somente para diagnóstico. Zerar o encoder fora do batente aberto pode invalidar a posição.
                        </p>
                        <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                            <Input
                                type="number"
                                min={1}
                                placeholder="Curso em ticks"
                                disabled={calibrationControlDisabled || firmwareState.moving || calibrationActive}
                                value={displayedMaxSteps}
                                onChange={(event) => setMaxStepsInput(event.target.value)}
                            />
                            <Button
                                variant="outline"
                                disabled={calibrationControlDisabled || firmwareState.moving || calibrationActive}
                                onClick={() => {
                                    const maxSteps = Number(displayedMaxSteps);
                                    if (!Number.isFinite(maxSteps) || maxSteps <= 0) {
                                        setFeedback({ kind: "error", message: "Informe um curso finito e positivo." });
                                        return;
                                    }
                                    sendCoverCommand("calibrate_max_steps", { maxSteps }, "Curso manual confirmado.");
                                }}
                            >
                                Aplicar curso
                            </Button>
                            <Button
                                variant="outline"
                                disabled={calibrationControlDisabled || firmwareState.moving || calibrationActive}
                                onClick={() => {
                                    if (window.confirm("A persiana está totalmente aberta? Zerar fora desse batente invalida a posição.")) {
                                        sendCoverCommand("calibrate_zero", {}, "Encoder zerado no ponto atual.");
                                    }
                                }}
                            >
                                Zerar encoder
                            </Button>
                        </div>
                    </div>
                </details>
            </CardContent>
        </Card>
    );
}

function CalibrationProgress({ step }: { step: CalibrationStep }) {
    const current = calibrationProgress(step);
    const labels = ["Abrir", "Salvar aberto", "Fechar", "Salvar fechado"];
    return (
        <div className="grid grid-cols-4 gap-1">
            {labels.map((label, index) => (
                <div key={label} className="space-y-1">
                    <div className={cn("h-1.5 rounded-full", index <= current ? "bg-primary" : "bg-zinc-800")} />
                    <span className={cn("text-[10px]", index <= current ? "text-foreground" : "text-muted-foreground")}>{label}</span>
                </div>
            ))}
        </div>
    );
}

function calibrationProgress(step: CalibrationStep): number {
    if (["move_open", "opening", "open_stopped"].includes(step)) return 0;
    if (step === "move_closed") return 1;
    if (["closing", "closed_stopped"].includes(step)) return 2;
    if (step === "complete") return 3;
    return -1;
}

function coverPosition(device: Device): number | null {
    const status = device.status as Device["status"] & { position?: unknown };
    const calibrated = booleanOrNull(nested(status.raw, "state", "calibrated"));
    const positionKnown = booleanOrNull(nested(status.raw, "state", "positionKnown"));
    if (calibrated === false || positionKnown === false) return null;
    const rawPosition = status.position ?? nested(status.raw, "state", "position") ?? status.dps?.position ?? status.dps?.["1"];
    const position = numberOrNull(rawPosition);
    if (position !== null) return Math.max(0, Math.min(100, Math.round(position)));
    if (rawPosition === null) return null;
    const state = String(device.status?.state || "").toLowerCase();
    if (state === "open") return 0;
    if (state === "closed" || state === "off") return 100;
    return 0;
}

function coverFirmwareState(device: Device) {
    const state = nested(device.status?.raw, "state") as Record<string, unknown> | undefined;
    const encoderTicksOpenApplied = numberOrNull(state?.encoderTicksOpenApplied);
    const encoderTicksClosedApplied = numberOrNull(state?.encoderTicksClosedApplied);
    const maxSteps = calibrationTravelTicks(encoderTicksOpenApplied, encoderTicksClosedApplied);

    return {
        targetPosition: numberOrNull(state?.targetPosition),
        moving: Boolean(state?.moving),
        calibrated: Boolean(state?.calibrated),
        pwm: numberOrNull(state?.pwm),
        rawEncoderTicks: numberOrNull(state?.rawEncoderTicks),
        normalizedEncoderTicks: numberOrNull(state?.normalizedEncoderTicks),
        encoderDirectionSign: numberOrNull(state?.encoderDirectionSign),
        motionDirection: stringOrNull(state?.motionDirection),
        calibrationState: stringOrNull(state?.calibrationState),
        positionKnown: booleanOrNull(state?.positionKnown),
        positionTrusted: booleanOrNull(state?.positionTrusted),
        maxSteps,
    };
}

function calibrationTravelTicks(openTicks: number | null, closedTicks: number | null): number | null {
    if (openTicks !== null && closedTicks !== null) {
        const distance = Math.abs(openTicks - closedTicks);
        if (distance > 0) return distance;
    }
    const fallback = Math.max(Math.abs(openTicks ?? 0), Math.abs(closedTicks ?? 0));
    return fallback > 0 ? fallback : null;
}

function numberOrNull(value: unknown): number | null {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function stringOrNull(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value.trim() : null;
}

function booleanOrNull(value: unknown): boolean | null {
    return typeof value === "boolean" ? value : null;
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
