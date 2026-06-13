"use client"

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSendCommand } from "@/hooks/use-devices";
import { cn } from "@/lib/utils";
import type { Device } from "@/src/services/devices.service";
import { Lightbulb, Palette, Power, Sun, ThermometerSun } from "lucide-react";
import { useEffect, useState } from "react";

type LightValue = string | number | boolean | null;

export function LightControl({ device, compact = false }: { device: Device; compact?: boolean }) {
    const { mutateAsync: sendCommand, isPending } = useSendCommand();
    const capabilities = lightCapabilities(device);
    const [brightness, setBrightness] = useState(capabilities.brightness);
    const [temperature, setTemperature] = useState(capabilities.temperature);
    const [color, setColor] = useState(hsvToHex(capabilities.color));

    useEffect(() => setBrightness(capabilities.brightness), [capabilities.brightness]);
    useEffect(() => setTemperature(capabilities.temperature), [capabilities.temperature]);
    useEffect(() => setColor(hsvToHex(capabilities.color)), [capabilities.color]);

    const setLightValue = async (code: string, dpsId: string, value: unknown, localValue: unknown = value) => {
        await sendCommand({
            deviceId: device.id,
            command: { command: "set", params: { code, dpsId, value, localValue } },
        });
    };

    const setMode = (mode: "white" | "colour") => setLightValue("work_mode", "21", mode);

    const togglePower = () => setLightValue("switch_led", "20", !capabilities.isOn);
    const applyBrightness = () => setLightValue("bright_value_v2", "22", brightness);
    const applyTemperature = async () => {
        await setMode("white");
        await setLightValue("temp_value_v2", "23", temperature);
    };
    const applyColor = async () => {
        const hsv = hexToHsv(color);
        await setMode("colour");
        await setLightValue("colour_data_v2", "24", JSON.stringify(hsv), hsvToTuyaHex(hsv));
    };

    const content = (
        <div className="space-y-5">
            <button
                className={cn(
                    "flex w-full items-center justify-between rounded-2xl border p-4 text-left transition disabled:opacity-60",
                    capabilities.isOn ? "border-yellow-400/40 bg-yellow-400/10" : "border-border bg-secondary/40",
                )}
                disabled={isPending}
                type="button"
                onClick={() => void togglePower()}
            >
                <span>
                    <span className="block font-medium">Liga/desliga</span>
                    <span className="text-xs text-muted-foreground">{capabilities.isOn ? "Ligada" : "Desligada"}</span>
                </span>
                <span className={cn("flex size-11 items-center justify-center rounded-full", capabilities.isOn ? "bg-yellow-400 text-black" : "bg-secondary")}>
                    <Power className="size-5" />
                </span>
            </button>

            {capabilities.hasBrightness ? (
                <LightSlider
                    icon={<Sun className="size-4" />}
                    label="Brilho"
                    value={brightness}
                    display={`${Math.round(brightness / 10)}%`}
                    disabled={isPending}
                    onChange={setBrightness}
                    onCommit={() => void applyBrightness()}
                />
            ) : null}

            {capabilities.hasTemperature ? (
                <LightSlider
                    icon={<ThermometerSun className="size-4" />}
                    label="Temperatura"
                    value={temperature}
                    display={temperatureLabel(temperature)}
                    disabled={isPending}
                    onChange={setTemperature}
                    onCommit={() => void applyTemperature()}
                />
            ) : null}

            {capabilities.hasColor ? (
                <div className="space-y-3 rounded-2xl border p-4">
                    <div className="flex items-center justify-between gap-3">
                        <span className="flex items-center gap-2 font-medium"><Palette className="size-4" /> Cor</span>
                        <input
                            aria-label="Cor da luz"
                            className="h-10 w-16 cursor-pointer rounded-lg border bg-transparent p-1"
                            disabled={isPending}
                            type="color"
                            value={color}
                            onChange={(event) => setColor(event.target.value)}
                        />
                    </div>
                    <Button className="w-full" disabled={isPending} variant="outline" onClick={() => void applyColor()}>
                        Aplicar cor
                    </Button>
                </div>
            ) : null}
        </div>
    );

    if (compact) return content;

    return (
        <Card className="w-full max-w-[720px] border-zinc-800 bg-[#1f1f1f] shadow-none">
            <CardHeader className="flex flex-row items-center justify-between">
                <div>
                    <CardTitle className="text-base">{device.name}</CardTitle>
                    <p className="text-sm text-muted-foreground">{capabilities.isOn ? "Ligada" : "Desligada"}</p>
                </div>
                <div className={cn("flex size-12 items-center justify-center rounded-full", capabilities.isOn ? "bg-yellow-400/20 text-yellow-400" : "bg-secondary text-muted-foreground")}>
                    <Lightbulb className="size-6" />
                </div>
            </CardHeader>
            <CardContent>{content}</CardContent>
        </Card>
    );
}

function LightSlider({
    icon,
    label,
    value,
    display,
    disabled,
    onChange,
    onCommit,
}: {
    icon: React.ReactNode;
    label: string;
    value: number;
    display: string;
    disabled: boolean;
    onChange: (value: number) => void;
    onCommit: () => void;
}) {
    return (
        <div className="space-y-3 rounded-2xl border p-4">
            <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 font-medium">{icon}{label}</span>
                <span className="text-sm text-muted-foreground">{display}</span>
            </div>
            <input
                aria-label={label}
                className="h-2 w-full cursor-pointer accent-yellow-400"
                disabled={disabled}
                max={1000}
                min={0}
                step={10}
                type="range"
                value={value}
                onChange={(event) => onChange(Number(event.target.value))}
                onPointerUp={onCommit}
                onKeyUp={(event) => {
                    if (event.key === "Enter") onCommit();
                }}
            />
        </div>
    );
}

function lightCapabilities(device: Device) {
    const status = new Map<string, LightValue>();
    for (const item of Array.isArray(device.capabilities.status) ? device.capabilities.status : []) {
        if (item && typeof item === "object" && "code" in item) status.set(String(item.code), item.value as LightValue);
    }
    const dps = device.status.dps || {};
    const value = (code: string, dpsId: string) => dps[code] ?? dps[dpsId] ?? status.get(code);
    const color = parseHsv(value("colour_data_v2", "24"));

    return {
        isOn: Boolean(value("switch_led", "20") ?? (device.status.state === "on")),
        hasBrightness: status.has("bright_value_v2") || value("bright_value_v2", "22") !== undefined,
        brightness: clamp(Number(value("bright_value_v2", "22") ?? 1000), 0, 1000),
        hasTemperature: status.has("temp_value_v2") || value("temp_value_v2", "23") !== undefined,
        temperature: clamp(Number(value("temp_value_v2", "23") ?? 500), 0, 1000),
        hasColor: status.has("colour_data_v2") || value("colour_data_v2", "24") !== undefined,
        color,
    };
}

function parseHsv(value: unknown): { h: number; s: number; v: number } {
    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value);
            if (parsed && typeof parsed === "object") return { h: Number(parsed.h || 0), s: Number(parsed.s || 0), v: Number(parsed.v || 1000) };
        } catch {
            if (/^[0-9a-f]{12}$/i.test(value)) {
                return { h: parseInt(value.slice(0, 4), 16), s: parseInt(value.slice(4, 8), 16), v: parseInt(value.slice(8, 12), 16) };
            }
        }
    }
    return { h: 0, s: 0, v: 1000 };
}

function hexToHsv(hex: string): { h: number; s: number; v: number } {
    const [r, g, b] = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    let h = 0;
    if (delta) {
        if (max === r) h = 60 * (((g - b) / delta) % 6);
        else if (max === g) h = 60 * ((b - r) / delta + 2);
        else h = 60 * ((r - g) / delta + 4);
    }
    return { h: Math.round((h + 360) % 360), s: Math.round(max ? (delta / max) * 1000 : 0), v: Math.round(max * 1000) };
}

function hsvToHex({ h, s, v }: { h: number; s: number; v: number }): string {
    const saturation = clamp(s / 1000, 0, 1);
    const value = clamp(v / 1000, 0, 1);
    const c = value * saturation;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = value - c;
    const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return `#${[r, g, b].map((channel) => Math.round((channel + m) * 255).toString(16).padStart(2, "0")).join("")}`;
}

function hsvToTuyaHex({ h, s, v }: { h: number; s: number; v: number }): string {
    return [h, s, v].map((item) => clamp(Math.round(item), 0, 1000).toString(16).padStart(4, "0")).join("");
}

function temperatureLabel(value: number): string {
    if (value < 330) return "Quente";
    if (value > 660) return "Fria";
    return "Neutra";
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}
