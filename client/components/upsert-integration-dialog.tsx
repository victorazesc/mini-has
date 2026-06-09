"use client"

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useDeleteIntegration, useUpdateIntegration } from "@/hooks/use-integrations"
import { PROVIDERS_NAME_BY_TYPE } from "@/src/constants/providers"
import { Integration } from "@/src/services/integration.service"
import { useState } from "react"

type IntegrationFormValues = {
    name: string;
    brokerUrl: string;
    discoveryPrefix: string;
    username: string;
    password: string;
    accessId: string;
    accessSecret: string;
    region: string;
    baseUrl: string;
    ip: string;
    port: string;
    deviceType: string;
    roomHint: string;
    mode: string;
};

type UpsertIntegrationDialogProps = {
    integration: Integration;
    children: React.ReactElement;
};

function stringValue(value: unknown): string {
    return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function initialValues(integration: Integration): IntegrationFormValues {
    return {
        name: integration.name ?? "",
        brokerUrl: stringValue(integration.config?.brokerUrl),
        discoveryPrefix: stringValue(integration.config?.discoveryPrefix) || "homeassistant",
        username: "",
        password: "",
        accessId: stringValue(integration.config?.accessId),
        accessSecret: "",
        region: stringValue(integration.config?.region) || "auto",
        baseUrl: stringValue(integration.config?.baseUrl),
        ip: stringValue(integration.config?.ip),
        port: stringValue(integration.config?.port) || "9009",
        deviceType: stringValue(integration.config?.deviceType),
        roomHint: stringValue(integration.config?.roomHint),
        mode: stringValue(integration.config?.mode),
    };
}

export function UpsertIntegrationDialog({ integration, children }: UpsertIntegrationDialogProps) {
    const [open, setOpen] = useState(false);
    const [values, setValues] = useState<IntegrationFormValues>(() => initialValues(integration));
    const [formError, setFormError] = useState<string | null>(null);
    const { mutateAsync: updateIntegration, isPending } = useUpdateIntegration();
    const { mutateAsync: deleteIntegration, isPending: isDeleting } = useDeleteIntegration();
    const providerName = PROVIDERS_NAME_BY_TYPE[integration.type as keyof typeof PROVIDERS_NAME_BY_TYPE] ?? integration.type;
    const isBusy = isPending || isDeleting;

    const handleOpenChange = (nextOpen: boolean) => {
        if (nextOpen) {
            setValues(initialValues(integration));
            setFormError(null);
        }

        setOpen(nextOpen);
    };

    const setValue = (key: keyof IntegrationFormValues, value: string) => {
        setValues((current) => ({ ...current, [key]: value }));
        setFormError(null);
    };

    const handleDelete = async () => {
        const confirmed = window.confirm("Excluir esta integração? Os dispositivos e itens pendentes importados por ela também serão removidos.");
        if (!confirmed) return;

        await deleteIntegration(integration.id);
        setOpen(false);
    };

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        const name = values.name.trim();
        if (!name) {
            setFormError("Nome e obrigatorio");
            return;
        }

        await updateIntegration({
            integrationId: integration.id,
            data: {
                name,
                config: configForIntegration(integration.type, values),
                testOnUpdate: true,
            },
        });

        setOpen(false);
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogTrigger render={children} nativeButton={true} />
            <DialogContent>
                <form onSubmit={handleSubmit}>
                    <DialogHeader>
                        <DialogTitle>Editar integração</DialogTitle>
                        <DialogDescription>{providerName}</DialogDescription>
                    </DialogHeader>

                    <div className="grid gap-4 py-6">
                        <FieldInput
                            id={`integration-${integration.id}-name`}
                            label="Nome"
                            value={values.name}
                            disabled={isBusy}
                            onChange={(value) => setValue("name", value)}
                        />

                        {integration.type === "mqtt" ? (
                            <>
                                <FieldInput
                                    id={`integration-${integration.id}-broker-url`}
                                    label="Broker URL"
                                    value={values.brokerUrl}
                                    placeholder="mqtt://localhost:1883"
                                    disabled={isBusy}
                                    onChange={(value) => setValue("brokerUrl", value)}
                                />
                                <FieldInput
                                    id={`integration-${integration.id}-discovery-prefix`}
                                    label="Discovery prefix"
                                    value={values.discoveryPrefix}
                                    disabled={isBusy}
                                    onChange={(value) => setValue("discoveryPrefix", value)}
                                />
                                <FieldInput
                                    id={`integration-${integration.id}-username`}
                                    label="Usuario"
                                    value={values.username}
                                    placeholder="Manter atual"
                                    disabled={isBusy}
                                    onChange={(value) => setValue("username", value)}
                                />
                                <FieldInput
                                    id={`integration-${integration.id}-password`}
                                    label="Senha"
                                    type="password"
                                    value={values.password}
                                    placeholder="Manter atual"
                                    disabled={isBusy}
                                    onChange={(value) => setValue("password", value)}
                                />
                            </>
                        ) : null}

                        {integration.type === "tuya_cloud" ? (
                            <>
                                <FieldInput
                                    id={`integration-${integration.id}-access-id`}
                                    label="Access ID"
                                    value={values.accessId}
                                    disabled={isBusy}
                                    onChange={(value) => setValue("accessId", value)}
                                />
                                <FieldInput
                                    id={`integration-${integration.id}-access-secret`}
                                    label="Access Secret"
                                    type="password"
                                    value={values.accessSecret}
                                    placeholder="Manter atual"
                                    disabled={isBusy}
                                    onChange={(value) => setValue("accessSecret", value)}
                                />
                                <FieldInput
                                    id={`integration-${integration.id}-region`}
                                    label="Região"
                                    value={values.region}
                                    disabled={isBusy}
                                    onChange={(value) => setValue("region", value)}
                                />
                            </>
                        ) : null}

                        {integration.type === "generic_iot" || integration.type === "persiana_custom" ? (
                            <>
                                <FieldInput
                                    id={`integration-${integration.id}-base-url`}
                                    label="Base URL"
                                    value={values.baseUrl}
                                    disabled={isBusy}
                                    onChange={(value) => setValue("baseUrl", value)}
                                />
                                <FieldInput
                                    id={`integration-${integration.id}-ip`}
                                    label="IP"
                                    value={values.ip}
                                    disabled={isBusy}
                                    onChange={(value) => setValue("ip", value)}
                                />
                                <FieldInput
                                    id={`integration-${integration.id}-device-type`}
                                    label="Tipo"
                                    value={values.deviceType}
                                    disabled={isBusy}
                                    onChange={(value) => setValue("deviceType", value)}
                                />
                                <FieldInput
                                    id={`integration-${integration.id}-room-hint`}
                                    label="Cômodo sugerido"
                                    value={values.roomHint}
                                    disabled={isBusy}
                                    onChange={(value) => setValue("roomHint", value)}
                                />
                            </>
                        ) : null}

                        {integration.type === "intelbras_izy_tuya" ? (
                            <FieldInput
                                id={`integration-${integration.id}-mode`}
                                label="Modo"
                                value={values.mode}
                                disabled={isBusy}
                                onChange={(value) => setValue("mode", value)}
                            />
                        ) : null}

                        {integration.type === "intelbras_amt8000" ? (
                            <>
                                <FieldInput
                                    id={`integration-${integration.id}-ip`}
                                    label="IP"
                                    value={values.ip}
                                    disabled={isBusy}
                                    onChange={(value) => setValue("ip", value)}
                                />
                                <FieldInput
                                    id={`integration-${integration.id}-port`}
                                    label="Porta"
                                    value={values.port}
                                    disabled={isBusy}
                                    onChange={(value) => setValue("port", value)}
                                />
                                <FieldInput
                                    id={`integration-${integration.id}-password`}
                                    label="Senha da central"
                                    type="password"
                                    value={values.password}
                                    placeholder="Manter atual"
                                    disabled={isBusy}
                                    onChange={(value) => setValue("password", value)}
                                />
                            </>
                        ) : null}

                        {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
                        <p className="text-xs text-muted-foreground">
                            Excluir a integração também remove os dispositivos e itens pendentes importados por ela.
                        </p>
                    </div>

                    <DialogFooter>
                        <Button type="button" variant="destructive" disabled={isBusy} onClick={handleDelete}>
                            {isDeleting ? "Excluindo..." : "Excluir"}
                        </Button>
                        <Button type="button" variant="outline" disabled={isBusy} onClick={() => setOpen(false)}>
                            Cancelar
                        </Button>
                        <Button type="submit" disabled={isBusy}>
                            {isPending ? "Salvando..." : "Salvar"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

function FieldInput({
    id,
    label,
    value,
    disabled,
    onChange,
    type = "text",
    placeholder,
}: {
    id: string;
    label: string;
    value: string;
    disabled: boolean;
    onChange: (value: string) => void;
    type?: string;
    placeholder?: string;
}) {
    return (
        <div className="grid gap-2">
            <Label htmlFor={id}>{label}</Label>
            <Input
                id={id}
                type={type}
                value={value}
                placeholder={placeholder}
                disabled={disabled}
                onChange={(event) => onChange(event.target.value)}
            />
        </div>
    );
}

function configForIntegration(type: string, values: IntegrationFormValues): Record<string, unknown> {
    if (type === "mqtt") {
        return compactConfig({
            brokerUrl: values.brokerUrl.trim(),
            discoveryPrefix: values.discoveryPrefix.trim(),
            username: values.username.trim(),
            password: values.password,
        });
    }

    if (type === "tuya_cloud") {
        return compactConfig({
            accessId: values.accessId.trim(),
            accessSecret: values.accessSecret,
            region: values.region.trim(),
        });
    }

    if (type === "generic_iot" || type === "persiana_custom") {
        return compactConfig({
            baseUrl: values.baseUrl.trim(),
            ip: values.ip.trim(),
            deviceType: values.deviceType.trim(),
            roomHint: values.roomHint.trim(),
        });
    }

    if (type === "intelbras_izy_tuya") {
        return compactConfig({
            mode: values.mode.trim(),
        });
    }

    if (type === "intelbras_amt8000") {
        return compactConfig({
            ip: values.ip.trim(),
            port: Number(values.port) || 9009,
            password: values.password,
        });
    }

    return {};
}

function compactConfig(config: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(
        Object.entries(config).filter(([, value]) => value !== undefined && value !== null && value !== ""),
    );
}
