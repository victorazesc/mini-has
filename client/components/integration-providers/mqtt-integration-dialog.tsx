import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldGroup } from "@/components/ui/field"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { useIntegrations } from "@/hooks/use-integrations"
import { useState } from "react"
import { z } from "zod"
import { toast } from "sonner"
import { ScanDevicesDialog } from "../scan-devices-dialog"

const schema = z.object({
    brokerUrl: z.string().optional(),
    username: z.string().optional(),
    password: z.string().optional(),
    discoveryPrefix: z.string().min(1, "Prefixo e obrigatorio"),
});

export function MqttIntegrationDialog({ open }: { open: boolean }) {
    const [values, setValues] = useState<z.infer<typeof schema>>({
        brokerUrl: "",
        username: "",
        password: "",
        discoveryPrefix: "homeassistant",
    });
    const [formError, setFormError] = useState<string | null>(null);
    const [showScanDialog, setShowScanDialog] = useState(false);
    const [integrationId, setIntegrationId] = useState<number | null>(null);
    const { mutateAsync: createIntegration, isPending, error } = useIntegrations();

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        const parsed = schema.safeParse(values);

        if (!parsed.success) {
            setFormError(parsed.error.issues[0]?.message ?? "Payload invalido.");
            return;
        }

        setFormError(null);

        try {
            const integration = await createIntegration({
                name: "MQTT",
                type: "mqtt",
                config: {
                    brokerUrl: parsed.data.brokerUrl?.trim() || undefined,
                    username: parsed.data.username?.trim() || undefined,
                    password: parsed.data.password || undefined,
                    discoveryPrefix: parsed.data.discoveryPrefix,
                } as unknown as JSON,
            });
            setIntegrationId(integration.id);
            toast.success("Integração MQTT criada com sucesso");
            setShowScanDialog(true);
        } catch (error) {
            if (error instanceof Error && error.message) {
                setFormError(error.message);
                return;
            }
            setFormError("Erro inesperado ao criar integracao.");
        }
    };

    return (
        <>
            <Dialog open={open && !showScanDialog}>
                <DialogContent className="sm:max-w-sm">
                    <form onSubmit={handleSubmit}>
                        <DialogHeader>
                            <DialogTitle>Integração MQTT</DialogTitle>
                            <DialogDescription>
                                Conecte no broker e importe dispositivos via MQTT Discovery.
                            </DialogDescription>
                        </DialogHeader>
                        <FieldGroup className="py-6">
                            <Field>
                                <Label htmlFor="mqtt-broker-url">Broker URL</Label>
                                <Input
                                    id="mqtt-broker-url"
                                    name="brokerUrl"
                                    placeholder="mqtt://localhost:1883"
                                    disabled={isPending}
                                    aria-invalid={Boolean(error)}
                                    value={values.brokerUrl}
                                    onChange={(event) => {
                                        setValues((prev) => ({ ...prev, brokerUrl: event.target.value }));
                                        setFormError(null);
                                    }}
                                />
                            </Field>
                            <Field>
                                <Label htmlFor="mqtt-username">Usuario</Label>
                                <Input
                                    id="mqtt-username"
                                    name="username"
                                    disabled={isPending}
                                    aria-invalid={Boolean(error)}
                                    value={values.username}
                                    onChange={(event) => {
                                        setValues((prev) => ({ ...prev, username: event.target.value }));
                                        setFormError(null);
                                    }}
                                />
                            </Field>
                            <Field>
                                <Label htmlFor="mqtt-password">Senha</Label>
                                <Input
                                    id="mqtt-password"
                                    name="password"
                                    type="password"
                                    disabled={isPending}
                                    aria-invalid={Boolean(error)}
                                    value={values.password}
                                    onChange={(event) => {
                                        setValues((prev) => ({ ...prev, password: event.target.value }));
                                        setFormError(null);
                                    }}
                                />
                            </Field>
                            <Field>
                                <Label htmlFor="mqtt-discovery-prefix">Discovery prefix</Label>
                                <Input
                                    id="mqtt-discovery-prefix"
                                    name="discoveryPrefix"
                                    disabled={isPending}
                                    aria-invalid={Boolean(error)}
                                    value={values.discoveryPrefix}
                                    onChange={(event) => {
                                        setValues((prev) => ({ ...prev, discoveryPrefix: event.target.value }));
                                        setFormError(null);
                                    }}
                                />
                            </Field>
                        </FieldGroup>
                        <FieldError className="text-center w-full mb-6">{formError}</FieldError>
                        <DialogFooter>
                            <DialogClose render={<Button variant="outline" disabled={isPending}>Cancelar</Button>} />
                            <Button type="submit" disabled={isPending}>
                                {isPending ? "Conectando..." : "Conectar"}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
            <ScanDevicesDialog open={showScanDialog} onOpenChange={setShowScanDialog} provider="mqtt" integrationId={integrationId ?? undefined} />
        </>
    )
}
