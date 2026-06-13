"use client"

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useDeviceHistory, useSendCommand } from "@/hooks/use-devices";
import { cn } from "@/lib/utils";
import type { Device, DeviceHistoryEntry } from "@/src/services/devices.service";
import { CalendarClock, Clock3, Minus, PawPrint, Plus, Utensils, History } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

const DAYS = [
    { bit: 1, short: "Dom" },
    { bit: 2, short: "Seg" },
    { bit: 4, short: "Ter" },
    { bit: 8, short: "Qua" },
    { bit: 16, short: "Qui" },
    { bit: 32, short: "Sex" },
    { bit: 64, short: "Sáb" },
] as const;

type FeedPlan = {
    id: string;
    days: number;
    hour: number;
    minute: number;
    portions: number;
    enabled: boolean;
};

export function FeederControl({ device, compact = false }: { device: Device; compact?: boolean }) {
    const { mutateAsync: sendCommand, isPending } = useSendCommand();
    const { data: history = [] } = useDeviceHistory(device.id, 100);
    const status = feederStatus(device);
    const [portions, setPortions] = useState(status.manualFeed);
    const [plans, setPlans] = useState<FeedPlan[]>(status.plans);
    const [editingPlan, setEditingPlan] = useState<FeedPlan | null>(null);

    useEffect(() => setPortions(status.manualFeed), [status.manualFeed]);
    useEffect(() => setPlans(status.plans), [status.planValue]);

    const feedRecords = useMemo(() => feederRecords(history), [history]);
    const activePlans = plans.filter((plan) => plan.enabled).length;

    const feedNow = async () => {
        await sendCommand({
            deviceId: device.id,
            command: {
                command: "set",
                params: { code: "manual_feed", dpsId: "3", value: portions, localValue: portions },
            },
        });
        toast.success(`${portions} porção(ões) enviada(s)`);
    };

    const persistPlans = async (nextPlans: FeedPlan[]) => {
        const previous = plans;
        setPlans(nextPlans);
        try {
            const value = encodeMealPlan(nextPlans);
            await sendCommand({
                deviceId: device.id,
                command: {
                    command: "set",
                    params: { code: "meal_plan", dpsId: "1", value, localValue: value },
                },
            });
            toast.success("Agenda do alimentador atualizada");
        } catch (error) {
            setPlans(previous);
            throw error;
        }
    };

    const content = (
        <div className={cn("space-y-4", compact && "space-y-3")}>
            <section className="rounded-2xl border bg-secondary/30 p-4">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <p className="flex items-center gap-2 font-medium"><PawPrint className="size-4" /> Alimentação manual</p>
                        <p className="mt-1 text-xs text-muted-foreground">{feedStateLabel(status.feedState)}</p>
                    </div>
                    <Badge variant="outline">Última: {status.feedReport} porção(ões)</Badge>
                </div>
                <div className="mt-4 flex items-center gap-3">
                    <PortionStepper value={portions} disabled={isPending} onChange={setPortions} />
                    <Button className="h-12 flex-1" disabled={isPending || !device.status.online} onClick={() => void feedNow()}>
                        <Utensils className="size-4" />
                        Servir agora
                    </Button>
                </div>
            </section>

            <section className="rounded-2xl border p-4">
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <p className="flex items-center gap-2 font-medium"><CalendarClock className="size-4" /> Agenda</p>
                        <p className="mt-1 text-xs text-muted-foreground">{activePlans} horário(s) ativo(s)</p>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => setEditingPlan(newPlan())}>Adicionar</Button>
                </div>
                <div className="mt-4 space-y-2">
                    {plans.length ? plans.map((plan) => (
                        <div key={plan.id} className="flex items-center gap-3 rounded-xl bg-secondary/35 p-3">
                            <button className="min-w-0 flex-1 text-left" type="button" onClick={() => setEditingPlan(plan)}>
                                <span className="block font-medium tabular-nums">{timeLabel(plan)}</span>
                                <span className="block truncate text-xs text-muted-foreground">{daysLabel(plan.days)} • {plan.portions} porção(ões)</span>
                            </button>
                            <Switch
                                checked={plan.enabled}
                                disabled={isPending}
                                onCheckedChange={(checked) => void persistPlans(plans.map((item) => item.id === plan.id ? { ...item, enabled: checked } : item))}
                            />
                        </div>
                    )) : (
                        <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Nenhum horário programado.</p>
                    )}
                </div>
            </section>

            {!compact ? (
                <section className="rounded-2xl border p-4">
                    <div className="flex items-center gap-2 font-medium"><History className="size-4" /> Registros recentes</div>
                    <div className="mt-4 space-y-2">
                        {feedRecords.length ? feedRecords.slice(0, 8).map((record) => (
                            <div key={record.id} className="flex items-center justify-between gap-3 rounded-xl bg-secondary/35 p-3 text-sm">
                                <span>{record.portions} porção(ões)</span>
                                <span className="flex items-center gap-1 text-xs text-muted-foreground"><Clock3 className="size-3" /> {record.date}</span>
                            </div>
                        )) : <p className="text-sm text-muted-foreground">Os próximos acionamentos aparecerão aqui.</p>}
                    </div>
                </section>
            ) : null}

            <FeedPlanDialog
                plan={editingPlan}
                onOpenChange={(open) => {
                    if (!open) setEditingPlan(null);
                }}
                onDelete={editingPlan && plans.some((plan) => plan.id === editingPlan.id)
                    ? () => void persistPlans(plans.filter((plan) => plan.id !== editingPlan.id)).then(() => setEditingPlan(null))
                    : undefined}
                onSave={(plan) => {
                    const exists = plans.some((item) => item.id === plan.id);
                    void persistPlans(exists ? plans.map((item) => item.id === plan.id ? plan : item) : [...plans, plan])
                        .then(() => setEditingPlan(null));
                }}
            />
        </div>
    );

    if (compact) return content;
    return (
        <Card className="w-full max-w-[760px]">
            <CardHeader>
                <CardTitle>Controle do alimentador</CardTitle>
            </CardHeader>
            <CardContent>{content}</CardContent>
        </Card>
    );
}

function PortionStepper({ value, disabled, onChange }: { value: number; disabled: boolean; onChange: (value: number) => void }) {
    return (
        <div className="flex h-12 items-center rounded-xl border bg-background">
            <Button aria-label="Diminuir porções" disabled={disabled || value <= 1} size="icon" variant="ghost" onClick={() => onChange(Math.max(1, value - 1))}>
                <Minus className="size-4" />
            </Button>
            <span className="w-12 text-center font-semibold tabular-nums">{value}</span>
            <Button aria-label="Aumentar porções" disabled={disabled || value >= 12} size="icon" variant="ghost" onClick={() => onChange(Math.min(12, value + 1))}>
                <Plus className="size-4" />
            </Button>
        </div>
    );
}

function FeedPlanDialog({ plan, onOpenChange, onDelete, onSave }: { plan: FeedPlan | null; onOpenChange: (open: boolean) => void; onDelete?: () => void; onSave: (plan: FeedPlan) => void }) {
    const [draft, setDraft] = useState<FeedPlan>(newPlan());
    useEffect(() => {
        if (plan) setDraft(plan);
    }, [plan]);

    return (
        <Dialog open={Boolean(plan)} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Horário de alimentação</DialogTitle>
                    <DialogDescription>Defina horário, dias da semana e quantidade de porções.</DialogDescription>
                </DialogHeader>
                <div className="space-y-5">
                    <label className="space-y-2 text-sm">
                        <span>Horário</span>
                        <Input type="time" value={timeLabel(draft)} onChange={(event) => {
                            const [hour, minute] = event.target.value.split(":").map(Number);
                            setDraft((current) => ({ ...current, hour, minute }));
                        }} />
                    </label>
                    <div className="space-y-2">
                        <span className="text-sm">Dias da semana</span>
                        <div className="grid grid-cols-4 gap-2">
                            {DAYS.map((day) => (
                                <Button
                                    key={day.bit}
                                    size="sm"
                                    type="button"
                                    variant={draft.days & day.bit ? "default" : "outline"}
                                    onClick={() => setDraft((current) => ({ ...current, days: current.days ^ day.bit }))}
                                >
                                    {day.short}
                                </Button>
                            ))}
                        </div>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                        <span className="text-sm">Porções</span>
                        <PortionStepper value={draft.portions} disabled={false} onChange={(portions) => setDraft((current) => ({ ...current, portions }))} />
                    </div>
                </div>
                <DialogFooter className="justify-between sm:justify-between">
                    {onDelete ? <Button variant="destructive" onClick={onDelete}>Excluir</Button> : <span />}
                    <Button disabled={!draft.days} onClick={() => onSave(draft)}>Salvar horário</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function feederStatus(device: Device) {
    const entries = Array.isArray(device.capabilities.status) ? device.capabilities.status as Array<{ code?: string; value?: unknown }> : [];
    const value = (code: string, dpsId: string) => device.status.dps?.[dpsId] ?? device.status.dps?.[code] ?? entries.find((entry) => entry.code === code)?.value;
    const planValue = String(value("meal_plan", "1") || "");
    return {
        feedState: String(value("feed_state", "4") || "standby"),
        feedReport: clampPortions(Number(value("feed_report", "15") || 0), 0),
        manualFeed: clampPortions(Number(value("manual_feed", "3") || 1)),
        planValue,
        plans: decodeMealPlan(planValue),
    };
}

function decodeMealPlan(value: string): FeedPlan[] {
    try {
        const bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
        if (bytes.length < 5 || bytes.length % 5 !== 0) return [];
        return Array.from({ length: bytes.length / 5 }, (_, index) => {
            const offset = index * 5;
            return {
                id: `${bytes[offset]}-${bytes[offset + 1]}-${bytes[offset + 2]}-${index}`,
                days: bytes[offset],
                hour: bytes[offset + 1],
                minute: bytes[offset + 2],
                portions: clampPortions(bytes[offset + 3]),
                enabled: bytes[offset + 4] === 1,
            };
        });
    } catch {
        return [];
    }
}

function encodeMealPlan(plans: FeedPlan[]): string {
    if (!plans.length) return btoa(String.fromCharCode(0));
    const bytes = plans.flatMap((plan) => [plan.days, plan.hour, plan.minute, clampPortions(plan.portions), plan.enabled ? 1 : 0]);
    return btoa(String.fromCharCode(...bytes));
}

function feederRecords(history: DeviceHistoryEntry[]) {
    return history.flatMap((item) => {
        if (item.kind === "event" && item.eventType === "feeder_feed_report") {
            return [{
                id: item.id,
                portions: clampPortions(Number(item.payload?.portions || 1)),
                date: new Date(item.createdAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }),
            }];
        }
        if (item.kind !== "command") return [];
        const params = item.command?.params as Record<string, unknown> | undefined;
        if (String(params?.code || "") !== "manual_feed" && String(params?.dpsId || "") !== "3") return [];
        return [{
            id: item.id,
            portions: clampPortions(Number(params?.value || params?.localValue || 1)),
            date: new Date(item.createdAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }),
        }];
    });
}

function newPlan(): FeedPlan {
    return { id: `new-${Date.now()}`, days: 127, hour: 7, minute: 30, portions: 1, enabled: true };
}

function clampPortions(value: number, min = 1) {
    return Math.min(12, Math.max(min, Number.isFinite(value) ? Math.round(value) : min));
}

function timeLabel(plan: FeedPlan) {
    return `${String(plan.hour).padStart(2, "0")}:${String(plan.minute).padStart(2, "0")}`;
}

function daysLabel(value: number) {
    if (value === 127) return "Todos os dias";
    return DAYS.filter((day) => value & day.bit).map((day) => day.short).join(", ") || "Nenhum dia";
}

function feedStateLabel(value: string) {
    if (value === "feeding") return "Servindo alimento";
    if (value === "done") return "Alimentação concluída";
    if (value === "offline") return "Alimentador offline";
    return "Pronto para servir";
}
