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
import { ScanDevicesDialog } from "../scan-devices-dialog"

const schema = z.object({
    token: z.string().min(1, "Token e obrigatorio"),
});

export function SmartThingsIntegrationDialog({ open }: { open: boolean }) {
    const [values, setValues] = useState<z.infer<typeof schema>>({
        token: "",
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
                name: "SmartThings Cloud",
                type: "smartthings_cloud",
                config: {
                    token: parsed.data.token,
                } as unknown as JSON,
            });

            setIntegrationId(integration.id);
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
                            <DialogTitle>Integração SmartThings</DialogTitle>
                            <DialogDescription>
                                Adicione seu token pessoal da SmartThings que pode ser obtido no site https://account.smartthings.com/tokens para sincronizar seus dispositivos.
                            </DialogDescription>
                        </DialogHeader>
                        <FieldGroup className="py-6">
                            <Field>
                                <Label htmlFor="smartthings-token">Token</Label>
                                <Input
                                    id="smartthings-token"
                                    name="token"
                                    type="password"
                                    placeholder="Digite seu token SmartThings"
                                    disabled={isPending}
                                    aria-invalid={Boolean(error)}
                                    value={values.token}
                                    onChange={(event) => {
                                        setValues({ token: event.target.value });
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
            <ScanDevicesDialog open={showScanDialog} onOpenChange={setShowScanDialog} provider="smartthings_cloud" integrationId={integrationId ?? undefined} />
        </>
    )
}
