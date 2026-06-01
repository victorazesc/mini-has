"use client"

import { NewIntegrationDialog } from "@/components/new-integration-dialog";
import { UpsertIntegrationDialog } from "@/components/upsert-integration-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useDevices } from "@/hooks/use-devices";
import { useIntegrationList, useSyncIntegration } from "@/hooks/use-integrations";
import { PROVIDERS_NAME_BY_TYPE } from "@/src/constants/providers";
import { Integration } from "@/src/services/integration.service";
import { Circle, Cloud, Loader2Icon, PlusCircle, RefreshCw, Router } from "lucide-react";

export default function IntegrationsPage() {
    const { data: integrations = [], isLoading, isError } = useIntegrationList();
    const { data: devices = [] } = useDevices();
    const { mutate: syncIntegration, isPending } = useSyncIntegration();

    const deviceCountByIntegration = devices.reduce<Record<number, number>>((acc, device) => {
        if (device.integrationId) acc[device.integrationId] = (acc[device.integrationId] ?? 0) + 1;
        return acc;
    }, {});

    return (
        <main className="flex flex-1 flex-col gap-4 px-4 lg:px-6">
            <section className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-semibold">Integrações</h1>
                    <p className="text-sm text-muted-foreground">Provedores configurados no Mini HAS.</p>
                </div>
                <NewIntegrationDialog>
                    <Button variant="outline">
                        <PlusCircle className="size-4" />
                        Nova integração
                    </Button>
                </NewIntegrationDialog>
            </section>

            {isLoading ? (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {[1, 2, 3].map((item) => (
                        <Card key={item} className="min-h-44 animate-pulse bg-secondary/40" />
                    ))}
                </div>
            ) : null}

            {isError ? (
                <Card>
                    <CardContent className="py-8 text-sm text-destructive">
                        Erro ao carregar integrações.
                    </CardContent>
                </Card>
            ) : null}

            {!isLoading && !isError && integrations.length === 0 ? (
                <Card>
                    <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
                        <Cloud className="size-10 text-muted-foreground" />
                        <div>
                            <p className="font-medium">Nenhuma integração configurada</p>
                            <p className="text-sm text-muted-foreground">Adicione SmartThings, MQTT, Tuya ou outro provider.</p>
                        </div>
                    </CardContent>
                </Card>
            ) : null}

            <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {integrations.map((integration) => (
                    <IntegrationCard
                        key={integration.id}
                        integration={integration}
                        deviceCount={deviceCountByIntegration[integration.id] ?? 0}
                        isSyncing={isPending}
                        onSync={() => syncIntegration(integration.id)}
                    />
                ))}
            </section>
        </main>
    );
}

function IntegrationCard({
    integration,
    deviceCount,
    isSyncing,
    onSync,
}: {
    integration: Integration;
    deviceCount: number;
    isSyncing: boolean;
    onSync: () => void;
}) {
    const providerName = PROVIDERS_NAME_BY_TYPE[integration.type as keyof typeof PROVIDERS_NAME_BY_TYPE] ?? integration.type;
    const lastSync = integration.lastSyncAt ? new Date(integration.lastSyncAt).toLocaleString("pt-BR") : "Nunca";
    const brokerUrl = typeof integration.config?.brokerUrl === "string" ? integration.config.brokerUrl : null;
    const region = typeof integration.config?.region === "string" ? integration.config.region : null;

    return (
        <Card className="border-zinc-800 bg-[#1f1f1f] shadow-none">
            <CardHeader className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <div className="flex size-11 items-center justify-center rounded-full bg-secondary">
                            <Cloud className="size-5" />
                        </div>
                        <div>
                            <CardTitle className="text-base">{integration.name || providerName}</CardTitle>
                            <p className="text-sm text-muted-foreground">{providerName}</p>
                        </div>
                    </div>
                    <StatusBadge status={integration.status} />
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                    <InfoItem label="Devices" value={String(deviceCount)} />
                    <InfoItem label="Último sync" value={lastSync} />
                </div>

                {brokerUrl || region ? (
                    <div className="rounded-lg bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
                        {brokerUrl ? <p>Broker: {brokerUrl}</p> : null}
                        {region ? <p>Região: {region}</p> : null}
                    </div>
                ) : null}

                {integration.error ? (
                    <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                        {integration.error}
                    </p>
                ) : null}

                <div className="flex gap-2">
                    <Button variant="outline" size="sm" disabled={isSyncing} onClick={onSync}>
                        {isSyncing ? <Loader2Icon className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                        Sincronizar
                    </Button>
                    <UpsertIntegrationDialog integration={integration}>
                        <Button variant="secondary" size="sm">Editar</Button>
                    </UpsertIntegrationDialog>
                </div>
            </CardContent>
        </Card>
    );
}

function InfoItem({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-lg bg-secondary/40 px-3 py-2">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-1 flex items-center gap-1 font-medium">
                {label === "Devices" ? <Router className="size-3" /> : null}
                {value}
            </p>
        </div>
    );
}

function StatusBadge({ status }: { status: string }) {
    const normalized = String(status || "").toLowerCase();
    const isConnected = normalized === "connected";
    const isError = normalized === "error";

    return (
        <Badge variant="outline" className={isConnected ? "text-green-500" : isError ? "text-red-500" : "text-muted-foreground"}>
            <Circle className={isConnected ? "size-2 fill-green-500" : isError ? "size-2 fill-red-500" : "size-2 fill-muted-foreground"} />
            {statusLabel(normalized)}
        </Badge>
    );
}

function statusLabel(status: string): string {
    if (status === "connected") return "Conectada";
    if (status === "syncing") return "Sincronizando";
    if (status === "error") return "Erro";
    if (status === "created") return "Criada";
    return status || "Desconhecida";
}
