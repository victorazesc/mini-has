"use client";

import { Lock, ShieldCheck, ShieldOff, Unlock } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type AlarmStatus = "armed" | "disarmed" | "arming" | "disarming" | "unknown";

type SlideAlarmActionProps = {
    status: AlarmStatus;
    disabled?: boolean;
    onArm: () => void | Promise<void>;
    onDisarm: () => void | Promise<void>;
};

const THUMB_SIZE = 48;
const COMPLETE_THRESHOLD = 0.88;

export function SlideAlarmAction({
    status,
    disabled = false,
    onArm,
    onDisarm,
}: SlideAlarmActionProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const progressRef = useRef(0);

    const [dragging, setDragging] = useState(false);
    const [progress, setProgress] = useState(0);

    const isArmed = status === "armed";
    const isDisarmed = status === "disarmed";
    const isBusy = status === "arming" || status === "disarming";
    const canInteract = !disabled && !isBusy && status !== "unknown";

    const action = isArmed ? "disarm" : "arm";

    const setSafeProgress = (value: number) => {
        progressRef.current = value;
        setProgress(value);
    };

    const reset = () => {
        setDragging(false);
        setSafeProgress(0);
    };

    const getProgressFromClientX = (clientX: number) => {
        if (!containerRef.current) return 0;

        const rect = containerRef.current.getBoundingClientRect();
        const max = rect.width - THUMB_SIZE - 8;
        const x = clientX - rect.left - THUMB_SIZE / 2;

        return Math.min(Math.max(x / max, 0), 1);
    };

    const updateProgress = (clientX: number) => {
        if (!canInteract) return;
        setSafeProgress(getProgressFromClientX(clientX));
    };

    const confirmIfCompleted = async () => {
        if (!canInteract) return;

        const currentProgress = progressRef.current;
        setDragging(false);

        if (currentProgress < COMPLETE_THRESHOLD) {
            setSafeProgress(0);
            return;
        }

        setSafeProgress(1);

        try {
            if (action === "arm") {
                await onArm();
            } else {
                await onDisarm();
            }
        } finally {
            window.setTimeout(() => {
                setSafeProgress(0);
            }, 450);
        }
    };

    useEffect(() => {
        if (!dragging) return;

        const handlePointerMove = (event: PointerEvent) => {
            updateProgress(event.clientX);
        };

        const handlePointerUp = () => {
            void confirmIfCompleted();
        };

        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handlePointerUp);
        window.addEventListener("pointercancel", handlePointerUp);

        return () => {
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("pointerup", handlePointerUp);
            window.removeEventListener("pointercancel", handlePointerUp);
        };
    }, [dragging, canInteract, action]);

    const completed = progress >= COMPLETE_THRESHOLD;
    const thumbTranslate = progress * 194;

    const label = (() => {
        if (status === "armed") return completed ? "Solte para desarmar" : "Central armada";
        if (status === "disarmed") return completed ? "Solte para armar" : "Central desarmada";
        if (status === "arming") return "Armando central...";
        if (status === "disarming") return "Desarmando central...";
        return "Status desconhecido";
    })();

    const helper = (() => {
        if (status === "armed") return "Deslize para desarmar";
        if (status === "disarmed") return "Deslize para armar";
        if (status === "arming") return "Aguarde confirmação";
        if (status === "disarming") return "Aguarde confirmação";
        return "Sem conexão com a central";
    })();

    return (
        <div
            ref={containerRef}
            className={cn(
                "relative h-16 w-[280px] overflow-hidden rounded-2xl border text-white shadow-lg backdrop-blur select-none touch-none",
                isArmed && "border-emerald-400/40 bg-emerald-950/80",
                isDisarmed && "border-zinc-500/40 bg-zinc-950/80",
                status === "arming" && "border-sky-400/40 bg-sky-950/80",
                status === "disarming" && "border-amber-400/40 bg-amber-950/80",
                status === "unknown" && "border-white/10 bg-black/50",
                !canInteract && "cursor-not-allowed opacity-80",
            )}
        >
            <div
                className={cn(
                    "absolute inset-y-0 left-0 transition-[width]",
                    action === "arm" && "bg-emerald-500/25",
                    action === "disarm" && "bg-amber-500/25",
                )}
                style={{ width: `${progress * 100}%` }}
            />

            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-16">
                <span className="text-sm font-semibold leading-tight">{label}</span>
                <span className="text-xs text-white/50">{helper}</span>
            </div>

            <button
                type="button"
                disabled={!canInteract}
                className={cn(
                    "absolute left-1 top-1 flex size-14 items-center justify-center rounded-xl text-black shadow-lg",
                    action === "arm" && "bg-emerald-400",
                    action === "disarm" && "bg-amber-400",
                    dragging ? "scale-105 transition-transform" : "transition-transform duration-200",
                    !canInteract && "opacity-70",
                )}
                style={{
                    transform: `translateX(${thumbTranslate}px)`,
                }}
                onPointerDown={(event) => {
                    if (!canInteract) return;

                    event.preventDefault();
                    setDragging(true);
                    updateProgress(event.clientX);
                }}
            >
                {status === "armed" ? (
                    <ShieldCheck className="size-5" />
                ) : status === "disarmed" ? (
                    <ShieldOff className="size-5" />
                ) : status === "disarming" ? (
                    <Unlock className="size-5" />
                ) : (
                    <Lock className="size-5" />
                )}
            </button>
        </div>
    );
}