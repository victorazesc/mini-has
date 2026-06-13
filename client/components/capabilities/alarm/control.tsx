"use client"

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSendCommand } from "@/hooks/use-devices";
import { useEntities } from "@/hooks/use-entities";
import { cn } from "@/lib/utils";
import type { Device } from "@/src/services/devices.service";
import type { Entity } from "@/src/services/entities.service";
import {
    AlertTriangle,
    Battery,
    DoorClosed,
    DoorOpen,
    Radio,
    RefreshCw,
    Shield,
    ShieldCheck,
    ShieldOff,
} from "lucide-react";

type AlarmState = Record<string, unknown>;

export function AlarmControl({ device, compact = false }: { device: Device; compact?: boolean }) {
    const { data: entities = [] } = useEntities();
    const { mutate: sendCommand, isPending } = useSendCommand();
    const alarmEntities = entities.filter((entity) => entity.deviceId === device.id);
    const zones = alarmEntities.filter(isZone).sort((a, b) => zoneNumber(a) - zoneNumber(b));
    const partitions = alarmEntities.filter(isPartition).sort((a, b) => partitionNumber(a) - partitionNumber(b));
    const siren = alarmEntities.find((entity) => entity.capabilities.deviceClass === "siren");
    const state = device.status as unknown as AlarmState;
    const alarmState = String(state.state || "unknown").toLowerCase();
    const armed = ["armed", "partial"].includes(alarmState);
    const openZones = zones.filter((zone) => Boolean(zone.state.open));
    const alertZones = zones.filter(hasZoneAlert);
    const bypassedZones = zones.filter((zone) => Boolean(zone.state.bypassed));

    const command = (action: string, partition?: number) => {
        if (action.startsWith("disarm") && !window.confirm("Desarmar a central de alarme?")) return;
        sendCommand({
            deviceId: device.id,
            command: { command: action, params: partition ? { partition } : {} },
        });
    };

    const content = (
        <div className="space-y-5">
            <div className={cn("rounded-2xl border p-4", armed ? "border-emerald-500/40 bg-emerald-500/10" : "bg-secondary/30")}>
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <p className="text-sm text-muted-foreground">Estado da central</p>
                        <p className="mt-1 text-xl font-semibold">{alarmStateLabel(alarmState)}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                            {device.status.online ? "Online" : "Offline"} • protocolo {String(device.capabilities.protocol || "-")}
                        </p>
                    </div>
                    <div className={cn("flex size-12 items-center justify-center rounded-full", armed ? "bg-emerald-500/20 text-emerald-400" : "bg-secondary text-muted-foreground")}>
                        {armed ? <ShieldCheck className="size-6" /> : <ShieldOff className="size-6" />}
                    </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                    <Button disabled={isPending || armed || openZones.length > 0} onClick={() => command("arm")} variant="outline">
                        <ShieldCheck className="size-4" /> Armar tudo
                    </Button>
                    <Button disabled={isPending || !armed} onClick={() => command("disarm")} variant="destructive">
                        <ShieldOff className="size-4" /> Desarmar tudo
                    </Button>
                </div>
                {openZones.length ? (
                    <p className="mt-3 text-xs text-amber-500">
                        Feche {openZones.length} zona(s) aberta(s) antes de armar.
                    </p>
                ) : null}
            </div>

            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                <StatusCard active={Boolean(siren?.state.active || state.siren)} danger icon={<Radio className="size-4" />} label="Sirene" value={Boolean(siren?.state.active || state.siren) ? "Disparada" : "Silenciosa"} />
                <StatusCard active={openZones.length > 0} danger icon={<DoorOpen className="size-4" />} label="Zonas abertas" value={String(openZones.length)} />
                <StatusCard active={String(state.battery || "").toLowerCase() !== "full"} danger icon={<Battery className="size-4" />} label="Bateria central" value={batteryLabel(state.battery)} />
                <StatusCard active={Boolean(state.tamper)} danger icon={<AlertTriangle className="size-4" />} label="Tamper" value={state.tamper ? "Detectado" : "Normal"} />
            </div>

            <div className="flex items-center justify-between gap-3">
                <div>
                    <p className="font-medium">Sensores e zonas</p>
                    <p className="text-xs text-muted-foreground">
                        {zones.length} zonas • {alertZones.length} alertas • {bypassedZones.length} ignoradas
                    </p>
                </div>
                <Button disabled={isPending} onClick={() => command("query")} size="sm" variant="outline">
                    <RefreshCw className={cn("size-4", isPending && "animate-spin")} /> Atualizar
                </Button>
            </div>

            {alertZones.length ? (
                <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4">
                    <p className="font-medium text-red-400">Zonas com atenção</p>
                    <p className="mt-1 text-sm text-muted-foreground">{alertZones.map((zone) => zone.name).join(", ")}</p>
                </div>
            ) : null}

            <div className={cn("grid gap-2", compact ? "grid-cols-1" : "sm:grid-cols-2 xl:grid-cols-3")}>
                {zones.map((zone) => <ZoneCard entity={zone} key={zone.id} />)}
                {!zones.length ? <p className="text-sm text-muted-foreground">Nenhuma zona encontrada.</p> : null}
            </div>

            {partitions.length ? (
                <div className="space-y-2">
                    <p className="font-medium">Partições</p>
                    {partitions.map((partition) => {
                        const index = partitionNumber(partition);
                        const partitionArmed = Boolean(partition.state.armed);
                        return (
                            <div className="flex items-center justify-between gap-3 rounded-2xl border p-3" key={partition.id}>
                                <div>
                                    <p className="font-medium">{partition.name}</p>
                                    <p className="text-xs text-muted-foreground">{partitionArmed ? "Armada" : "Desarmada"}</p>
                                </div>
                                <Button
                                    disabled={isPending}
                                    onClick={() => command(partitionArmed ? "disarm_partition" : "arm_partition", index)}
                                    size="sm"
                                    variant={partitionArmed ? "destructive" : "outline"}
                                >
                                    {partitionArmed ? "Desarmar" : "Armar"}
                                </Button>
                            </div>
                        );
                    })}
                </div>
            ) : null}
        </div>
    );

    if (compact) return content;

    return (
        <Card className="w-full border-zinc-800 bg-[#1f1f1f] shadow-none">
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base"><Shield className="size-5" /> Controle da central de alarme</CardTitle>
            </CardHeader>
            <CardContent>{content}</CardContent>
        </Card>
    );
}

function StatusCard({ icon, label, value, active, danger = false }: { icon: React.ReactNode; label: string; value: string; active: boolean; danger?: boolean }) {
    return (
        <div className={cn("rounded-2xl border p-3", active && (danger ? "border-red-500/40 bg-red-500/10 text-red-400" : "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"))}>
            <span className="flex items-center gap-2 text-xs text-muted-foreground">{icon}{label}</span>
            <p className="mt-2 font-medium">{value}</p>
        </div>
    );
}

function ZoneCard({ entity }: { entity: Entity }) {
    const open = Boolean(entity.state.open);
    const alert = hasZoneAlert(entity);
    return (
        <div className={cn("rounded-2xl border p-3", alert ? "border-red-500/40 bg-red-500/10" : open ? "border-amber-500/40 bg-amber-500/10" : "bg-secondary/20")}>
            <div className="flex items-start justify-between gap-3">
                <div>
                    <p className="font-medium">{entity.name}</p>
                    <p className="text-xs text-muted-foreground">Zona {zoneNumber(entity)} • {open ? "Aberta" : "Fechada"}</p>
                </div>
                {open ? <DoorOpen className="size-5 text-amber-500" /> : <DoorClosed className="size-5 text-emerald-500" />}
            </div>
            <div className="mt-3 flex flex-wrap gap-1">
                {entity.state.violated ? <ZoneBadge label="Violada" danger /> : null}
                {entity.state.tamper ? <ZoneBadge label="Tamper" danger /> : null}
                {entity.state.lowBattery ? <ZoneBadge label="Bateria baixa" danger /> : null}
                {entity.state.bypassed ? <ZoneBadge label="Ignorada" /> : null}
                {!alert && !entity.state.bypassed ? <ZoneBadge label="Normal" /> : null}
            </div>
        </div>
    );
}

function ZoneBadge({ label, danger = false }: { label: string; danger?: boolean }) {
    return <span className={cn("rounded-full bg-secondary px-2 py-1 text-[10px] text-muted-foreground", danger && "bg-red-500/20 text-red-400")}>{label}</span>;
}

function isZone(entity: Entity): boolean {
    return entity.type === "binary_sensor" && Number.isInteger(Number(entity.capabilities.zone));
}

function isPartition(entity: Entity): boolean {
    return entity.type === "alarm" && Number.isInteger(Number(entity.capabilities.partition));
}

function zoneNumber(entity: Entity): number {
    return Number(entity.capabilities.zone || 0);
}

function partitionNumber(entity: Entity): number {
    return Number(entity.capabilities.partition || entity.commandSchema.partition || 0);
}

function hasZoneAlert(entity: Entity): boolean {
    return Boolean(entity.state.violated || entity.state.tamper || entity.state.lowBattery);
}

function alarmStateLabel(state: string): string {
    if (state === "armed") return "Armada";
    if (state === "partial") return "Armada parcialmente";
    if (state === "disarmed") return "Desarmada";
    if (state === "firing") return "Em disparo";
    return "Estado desconhecido";
}

function batteryLabel(value: unknown): string {
    const battery = String(value || "").toLowerCase();
    if (battery === "full") return "Carregada";
    if (battery === "low") return "Baixa";
    return battery || "Sem leitura";
}
