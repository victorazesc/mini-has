import { useRef } from "react";
import { ArrowRightLeft, ArrowUpDown, Bed, Circle, CircleGauge, CircleSlash, DropletOff, Fan, Minus, Move, Plus, Power, Rocket, Snowflake, VolumeOff, Wind } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

const climateModes = {
    auto: {
        icon: <CircleGauge className="size-6" />,
        label: "Auto",
        value: "auto",
    },
    cool: {
        icon: <Snowflake className="size-6" />,
        label: "Frio",
        value: "cool",
    },
    dry: {
        icon: <DropletOff className="size-6" />,
        label: "Seco",
        value: "dry",
    },
    wind: {
        icon: <Fan className="size-6" />,
        label: "Ventilador",
        value: "wind",
    },
    off: {
        icon: <Power className="size-6" />,
        label: "Desligado",
        value: "off",
    },
} as const;

const climateFanModes = {
    auto: {
        icon: <CircleGauge className="size-6" />,
        label: "Auto",
        value: "auto",
    },
    low: {
        icon: <Fan className="size-6" />,
        label: "Baixo",
        value: "low",
    },
    medium: {
        icon: <Fan className="size-6" />,
        label: "Médio",
        value: "medium",
    },
    high: {
        icon: <Fan className="size-6" />,
        label: "Alto",
        value: "high",
    },
} as const;

const climateFanDirections = {
    fixed: {
        icon: <CircleSlash className="size-6" />,
        label: "Desligado",
        value: "fixed",
    },
    vertical: {
        icon: <ArrowUpDown className="size-6" />,
        label: "Vertical",
        value: "vertical",
    },
    horizontal: {
        icon: <ArrowRightLeft className="size-6" />,
        label: "Horizontal",
        value: "horizontal",
    },
    both: {
        icon: <Move className="size-6" />,
        label: "Ambos",
        value: "both",
    },
} as const;

const climatePredefinedModes = {
    off: {
        icon: <Circle className="size-6" />,
        label: "Nenhum",
        value: "off",
    },
    sleep: {
        icon: <Bed className="size-6" />,
        label: "Sono",
        value: "sleep",
    },
    quiet: {
        icon: <VolumeOff className="size-6" />,
        label: "Silencioso",
        value: "quiet",
    },
    boost: {
        icon: <Rocket className="size-6" />,
        label: "Turbo",
        value: "boost",
    },
    windFree: {
        icon: <Wind className="size-6" />,
        label: "Sem Vento",
        value: "windFree",
    },
    windFreeSleep: {
        icon: <Wind className="size-6" />,
        label: "Sem Vento - Sono",
        value: "windFreeSleep",
    },

} as const;

export type ClimateMode = keyof typeof climateModes;
export type ClimateFanMode = keyof typeof climateFanModes;
export type ClimateFanDirection = keyof typeof climateFanDirections;
export type ClimatePredefinedMode = keyof typeof climatePredefinedModes;

type ClimateDialProps = {
    compact?: boolean;
    isLoading?: boolean;
    value: number;
    currentTemperature?: number | null;
    min?: number;
    max?: number;
    unit?: string;
    status?: ClimateMode;
    mode?: ClimateMode;
    fanMode?: ClimateFanMode;
    fanDirection?: ClimateFanDirection;
    predefinedMode?: ClimatePredefinedMode;
    onChangeMode?: (mode: ClimateMode) => void;
    onChangeFanMode?: (mode: ClimateFanMode) => void;
    onChangeFanDirection?: (direction: ClimateFanDirection) => void;
    onChangePredefinedMode?: (mode: ClimatePredefinedMode) => void;
    onChange?: (value: number) => void;
    onCommit?: (value: number) => void;
};

export function ClimateDial({
    compact = false,
    isLoading = false,
    value,
    currentTemperature,
    min = 16,
    max = 30,
    unit = "°C",
    status = "off",
    mode = "auto",
    fanMode = "auto",
    fanDirection = "fixed",
    predefinedMode = "off",
    onChangeMode,
    onChangeFanMode,
    onChangeFanDirection,
    onChangePredefinedMode,
    onChange,
    onCommit,
}: ClimateDialProps) {
    const svgRef = useRef<SVGSVGElement | null>(null);
    const controlsDisabled = status === "off";
    const safeRange = Math.max(max - min, 1);
    const percentage = Math.min(Math.max((value - min) / safeRange, 0), 1);
    const pendingValueRef = useRef<number | null>(null);

    /**
     * Sistema de ângulos:
     * 0° fica no topo, 90° à direita, 180° embaixo e 270° à esquerda.
     * O arco começa no canto inferior esquerdo e termina no canto inferior direito,
     * passando pela parte superior. Isso cria o formato de "C" aberto embaixo.
     */
    const startAngle = 220;
    const endAngle = 500;
    const currentAngle = startAngle + (endAngle - startAngle) * percentage;

    const radius = 128;
    const center = 160;

    const polarToCartesian = (angle: number) => {
        const angleRad = ((angle - 90) * Math.PI) / 180;

        return {
            x: center + radius * Math.cos(angleRad),
            y: center + radius * Math.sin(angleRad),
        };
    };

    const describeArc = (start: number, end: number) => {
        const startPoint = polarToCartesian(start);
        const endPoint = polarToCartesian(end);

        const largeArcFlag = end - start <= 180 ? "0" : "1";

        return [
            "M",
            startPoint.x,
            startPoint.y,
            "A",
            radius,
            radius,
            0,
            largeArcFlag,
            1,
            endPoint.x,
            endPoint.y,
        ].join(" ");
    };

    const applyTemperatureChange = (nextValue: number, commit = false) => {
        if (controlsDisabled) return value;

        const clampedValue = Math.min(Math.max(nextValue, min), max);

        pendingValueRef.current = clampedValue;
        onChange?.(clampedValue);

        if (commit) {
            onCommit?.(clampedValue);
            pendingValueRef.current = null;
        }

        return clampedValue;
    };

    const getAngleFromPointer = (event: React.PointerEvent<SVGElement>) => {
        if (controlsDisabled) return null;

        const svg = svgRef.current;
        if (!svg) return null;

        const rect = svg.getBoundingClientRect();
        const x = ((event.clientX - rect.left) / rect.width) * 320;
        const y = ((event.clientY - rect.top) / rect.height) * 320;

        const dx = x - center;
        const dy = y - center;

        // Mantém o mesmo sistema usado no polarToCartesian:
        // 0° no topo, 90° à direita, 180° embaixo, 270° à esquerda.
        let angle = (Math.atan2(dy, dx) * 180) / Math.PI + 90;

        if (angle < startAngle) {
            angle += 360;
        }

        return Math.min(Math.max(angle, startAngle), endAngle);
    };

    const updateValueFromPointer = (event: React.PointerEvent<SVGElement>) => {
        if (!onChange) return null;

        const angle = getAngleFromPointer(event);
        if (angle === null) return null;

        const nextPercentage = (angle - startAngle) / (endAngle - startAngle);
        const rawValue = min + nextPercentage * safeRange;
        const nextValue = Math.round(rawValue);
        return applyTemperatureChange(nextValue);
    };

    const handlePointerDown = (event: React.PointerEvent<SVGElement>) => {
        if (!onChange || controlsDisabled) return;

        pendingValueRef.current = value;
        event.currentTarget.setPointerCapture(event.pointerId);
        updateValueFromPointer(event);
    };

    const handlePointerMove = (event: React.PointerEvent<SVGElement>) => {
        if (!onChange || controlsDisabled || !event.currentTarget.hasPointerCapture(event.pointerId)) {
            return;
        }

        updateValueFromPointer(event);
    };

    const handlePointerUp = (event: React.PointerEvent<SVGElement>) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }

        if (pendingValueRef.current !== null) {
            onCommit?.(pendingValueRef.current);
            pendingValueRef.current = null;
        }
    };

    const handleDecrease = () => {
        applyTemperatureChange(value - 1, true);
    };

    const handleIncrease = () => {
        applyTemperatureChange(value + 1, true);
    };

    const thumb = polarToCartesian(currentAngle);
    const formattedCurrentTemperature = typeof currentTemperature === "number" && Number.isFinite(currentTemperature)
        ? `${Math.round(currentTemperature)}${unit}`
        : "--";

    if (compact) {
        return (
            <div className="w-full space-y-3 overflow-hidden rounded-2xl border border-white/10 bg-white/8 p-3">
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <p className="text-xs text-white/45">Temperatura atual</p>
                        <p className="mt-1 text-lg font-medium">{formattedCurrentTemperature}</p>
                    </div>
                    <p className="rounded-full bg-white/8 px-3 py-1 text-xs text-white/65">
                        {climateModes[status]?.label}
                    </p>
                </div>

                <div className="flex items-center justify-between gap-3 rounded-xl bg-black/25 p-3">
                    <Button
                        aria-label="Diminuir temperatura"
                        variant="outline"
                        size="icon"
                        onClick={handleDecrease}
                        disabled={controlsDisabled || isLoading}
                        className="size-11 shrink-0 rounded-full border-white/15 bg-transparent text-white hover:bg-white/10"
                    >
                        <Minus className="size-5" />
                    </Button>
                    <div className="min-w-0 text-center">
                        <p className="text-xs text-white/45">Temperatura desejada</p>
                        <p className="mt-1 text-4xl font-light tabular-nums">{Math.floor(value)}{unit}</p>
                    </div>
                    <Button
                        aria-label="Aumentar temperatura"
                        variant="outline"
                        size="icon"
                        onClick={handleIncrease}
                        disabled={controlsDisabled || isLoading}
                        className="size-11 shrink-0 rounded-full border-white/15 bg-transparent text-white hover:bg-white/10"
                    >
                        <Plus className="size-5" />
                    </Button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                    <CompactClimateSelect label="Modo" value={mode} options={Object.values(climateModes)} onValueChange={(value) => onChangeMode?.(value as ClimateMode)} />
                    <CompactClimateSelect disabled={controlsDisabled} label="Ventilador" value={fanMode} options={Object.values(climateFanModes)} onValueChange={(value) => onChangeFanMode?.(value as ClimateFanMode)} />
                    <CompactClimateSelect disabled={controlsDisabled} label="Direção" value={fanDirection} options={Object.values(climateFanDirections)} onValueChange={(value) => onChangeFanDirection?.(value as ClimateFanDirection)} />
                    <CompactClimateSelect disabled={controlsDisabled} label="Extra" value={predefinedMode} options={Object.values(climatePredefinedModes)} onValueChange={(value) => onChangePredefinedMode?.(value as ClimatePredefinedMode)} />
                </div>
            </div>
        );
    }

    if (isLoading) {
        return (
            <Card className="w-fit border-zinc-800 bg-[#1f1f1f] shadow-none overflow-hidden">
                <CardHeader className="w-full items-center text-center mb-0 pb-0">
                    <Skeleton className="h-5 w-40" />
                    <Skeleton className="h-8 w-20" />
                </CardHeader>
                <CardContent className="relative flex min-h-[320px] flex-col items-center justify-center mt-0 pt-0">
                    <div className="relative flex h-[320px] w-[340px] -translate-y-3 items-center justify-center">
                        <Skeleton className="size-64 rounded-full" />
                        <div className="absolute flex flex-col items-center gap-4">
                            <Skeleton className="h-6 w-20" />
                            <Skeleton className="h-24 w-32" />
                        </div>
                    </div>
                    <div className="absolute bottom-0 flex items-center gap-10">
                        <Skeleton className="size-14 rounded-full" />
                        <Skeleton className="size-14 rounded-full" />
                    </div>
                </CardContent>
                <CardFooter>
                    <div className="flex items-center gap-4 justify-between w-full">
                        <Skeleton className="h-14 w-44 rounded-md" />
                        <Skeleton className="h-14 w-44 rounded-md" />
                        <Skeleton className="h-14 w-44 rounded-md" />
                        <Skeleton className="h-14 w-44 rounded-md" />
                    </div>
                </CardFooter>
            </Card>
        );
    }

    return (
        <Card className="w-fit border-zinc-800 bg-[#1f1f1f] shadow-none overflow-hidden">
            <CardHeader className="w-full text-center mb-0 pb-0">
                <CardDescription >
                    <h3 className="text-sm font-medium">Temperatura Atual</h3>
                </CardDescription>
                <CardTitle>{formattedCurrentTemperature}</CardTitle>
            </CardHeader>
            <CardContent className="relative flex min-h-[320px] flex-col items-center justify-center mt-0 pt-0">
                <div className="relative h-[320px] w-[340px] -translate-y-3">
                    <svg
                        ref={svgRef}
                        viewBox="0 0 320 320"
                        className="absolute inset-0 h-full w-full touch-none select-none"
                    >
                        {/* arco base */}
                        <path
                            d={describeArc(startAngle, endAngle)}
                            fill="none"
                            stroke="rgba(255,255,255,0.08)"
                            strokeWidth="24"
                            strokeLinecap="round"
                            pointerEvents="none"
                        />

                        {/* arco ativo */}
                        {status !== "off" ? (
                            <path
                                d={describeArc(startAngle, Math.max(currentAngle, startAngle + 0.01))}
                                fill="none"
                                stroke="rgba(34,197,94,0.85)"
                                strokeWidth="24"
                                strokeLinecap="round"
                                pointerEvents="none"
                            />
                        ) : null}

                        {/* bolinha principal */}
                        <circle
                            cx={thumb.x}
                            cy={thumb.y}
                            r="13"
                            fill="#f4f4f5"
                            stroke="rgba(255,255,255,0.45)"
                            strokeWidth="4"
                            className={controlsDisabled ? "touch-none opacity-60" : "cursor-grab touch-none active:cursor-grabbing"}
                            pointerEvents={controlsDisabled ? "none" : "all"}
                            onPointerDown={handlePointerDown}
                            onPointerMove={handlePointerMove}
                            onPointerUp={handlePointerUp}
                            onPointerCancel={handlePointerUp}
                        />
                        <circle
                            cx={thumb.x}
                            cy={thumb.y}
                            r="34"
                            fill="transparent"
                            className={controlsDisabled ? "touch-none" : "cursor-grab touch-none active:cursor-grabbing"}
                            pointerEvents={controlsDisabled ? "none" : "all"}
                            onPointerDown={handlePointerDown}
                            onPointerMove={handlePointerMove}
                            onPointerUp={handlePointerUp}
                            onPointerCancel={handlePointerUp}
                        />

                        {/* bolinha pequena ao lado */}
                        {/* <circle
              cx={polarToCartesian(Math.min(currentAngle + 10, endAngle)).x}
              cy={polarToCartesian(Math.min(currentAngle + 10, endAngle)).y}
              r="5"
              fill="rgba(255,255,255,0.35)"
              pointerEvents="none"
            /> */}
                    </svg>

                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                        <span className="mb-5 text-lg font-semibold text-zinc-300">
                            {climateModes[status]?.label}
                        </span>

                        <div className="flex items-start">
                            <span className="text-7xl font-light tracking-[-0.08em] text-zinc-100 tabular-nums">
                                {Math.floor(value)}
                            </span>

                            <div className="ml-3 mt-4 flex flex-col leading-none">
                                <span className="text-2xl font-light text-zinc-200">{unit}</span>
                                <span className="mt-2 text-3xl font-light text-zinc-300">
                                    .0
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="absolute bottom-0 flex items-center gap-10">
                    <Button
                        variant="outline"
                        size="icon"
                        onClick={handleDecrease}
                        disabled={controlsDisabled}
                        className="h-14 w-14 rounded-full border-zinc-500 bg-transparent text-zinc-200 hover:bg-zinc-800"
                    >
                        <Minus className="h-6 w-6" />
                    </Button>

                    <Button
                        variant="outline"
                        size="icon"
                        onClick={handleIncrease}
                        disabled={controlsDisabled}
                        className="h-14 w-14 rounded-full border-zinc-500 bg-transparent text-zinc-200 hover:bg-zinc-800"
                    >
                        <Plus className="h-6 w-6" />
                    </Button>
                </div>
            </CardContent>
            <CardFooter>
                <div className="flex items-center gap-4 justify-between w-full">
                    <div className="flex flex-col items-center gap-2">
                        <Select value={mode} onValueChange={(value) => onChangeMode?.(value as ClimateMode)}>
                            <SelectTrigger className="rounded-md h-14!">
                                <SelectValue>
                                    {(value) => {
                                        const mode = climateModes[value as ClimateMode];

                                        return (
                                            <div className="flex items-center gap-2">
                                                {mode?.icon}
                                                <div className="flex flex-col items-start">
                                                    <span className="text-sm font-medium">Modo</span>
                                                    <span className="text-sm text-muted-foreground">{mode?.label}</span>
                                                </div>
                                            </div>
                                        );
                                    }}
                                </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                                {Object.values(climateModes).map((mode) => (
                                    <SelectItem key={mode.value} value={mode.value}>
                                        {mode.icon}
                                        {mode.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="flex flex-col items-center gap-2">
                        <Select disabled={controlsDisabled} value={fanMode} onValueChange={(value) => onChangeFanMode?.(value as ClimateFanMode)}>
                            <SelectTrigger className="rounded-md h-14!">
                                <SelectValue>
                                    {(value) => {
                                        const mode = climateFanModes[value as ClimateFanMode];

                                        return (
                                            <div className="flex items-center gap-2">
                                                {mode?.icon}
                                                <div className="flex flex-col items-start">
                                                    <span className="text-sm font-medium">Modo</span>
                                                    <span className="text-sm text-muted-foreground">{mode?.label}</span>
                                                </div>
                                            </div>
                                        );
                                    }}
                                </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                                {Object.values(climateFanModes).map((mode) => (
                                    <SelectItem key={mode.value} value={mode.value}>
                                        {mode.icon}
                                        {mode.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="flex flex-col items-center gap-2">
                        <Select disabled={controlsDisabled} value={fanDirection} onValueChange={(value) => onChangeFanDirection?.(value as ClimateFanDirection)}>
                            <SelectTrigger className="rounded-md h-14!">
                                <SelectValue>
                                    {(value) => {
                                        const mode = climateFanDirections[value as ClimateFanDirection];

                                        return (
                                            <div className="flex items-center gap-2">
                                                {mode?.icon}
                                                <div className="flex flex-col items-start">
                                                    <span className="text-sm font-medium">Modo</span>
                                                    <span className="text-sm text-muted-foreground">{mode?.label}</span>
                                                </div>
                                            </div>
                                        );
                                    }}
                                </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                                {Object.values(climateFanDirections).map((mode) => (
                                    <SelectItem key={mode.value} value={mode.value}>
                                        {mode.icon}
                                        {mode.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="flex flex-col items-center gap-2">
                        <Select disabled={controlsDisabled} value={predefinedMode} onValueChange={(value) => onChangePredefinedMode?.(value as ClimatePredefinedMode)}>
                            <SelectTrigger className="rounded-md h-14!">
                                <SelectValue>
                                    {(value) => {
                                        const mode = climatePredefinedModes[value as ClimatePredefinedMode];

                                        return (
                                            <div className="flex items-center gap-2">
                                                {mode?.icon}
                                                <div className="flex flex-col items-start">
                                                    <span className="text-sm font-medium">Modo</span>
                                                    <span className="text-sm text-muted-foreground">{mode?.label}</span>
                                                </div>
                                            </div>
                                        );
                                    }}
                                </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                                {Object.values(climatePredefinedModes).map((mode) => (
                                    <SelectItem key={mode.value} value={mode.value}>
                                        {mode.icon}
                                        {mode.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            </CardFooter>
        </Card>
    );
}

function CompactClimateSelect({
    disabled = false,
    label,
    value,
    options,
    onValueChange,
}: {
    disabled?: boolean;
    label: string;
    value: string;
    options: readonly { icon: React.ReactNode; label: string; value: string }[];
    onValueChange: (value: string) => void;
}) {
    const selected = options.find((option) => option.value === value);

    return (
        <Select disabled={disabled} value={value} onValueChange={(nextValue) => {
            if (nextValue) onValueChange(nextValue);
        }}>
            <SelectTrigger className="h-auto min-w-0 rounded-xl border-white/10 bg-black/20 px-3 py-2">
                <SelectValue>
                    <div className="flex min-w-0 items-center gap-2">
                        <span className="[&>svg]:size-4">{selected?.icon}</span>
                        <span className="min-w-0 text-left">
                            <span className="block text-[10px] uppercase tracking-wide text-white/40">{label}</span>
                            <span className="block truncate text-xs text-white/80">{selected?.label}</span>
                        </span>
                    </div>
                </SelectValue>
            </SelectTrigger>
            <SelectContent>
                {options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                        {option.icon}
                        {option.label}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}
