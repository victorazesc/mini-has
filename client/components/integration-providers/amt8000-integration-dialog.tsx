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
    ip: z.string().trim().min(1, "IP e obrigatorio"),
    port: z.string().regex(/^\d+$/, "Porta invalida"),
    password: z.string().regex(/^\d{4}(\d{2})?$/, "A senha deve ter 4 ou 6 digitos"),
});

export function Amt8000IntegrationDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
    const [values, setValues] = useState<z.infer<typeof schema>>({
        ip: "192.168.1.33",
        port: "9009",
        password: "",
    });
    const [formError, setFormError] = useState<string | null>(null);
    const [showScanDialog, setShowScanDialog] = useState(false);
    const [integrationId, setIntegrationId] = useState<number | null>(null);
    const { mutateAsync: createIntegration, isPending, error } = useIntegrations();

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const parsed = schema.safeParse(values);
        const port = Number(parsed.success ? parsed.data.port : 0);

        if (!parsed.success) {
            setFormError(parsed.error.issues[0]?.message ?? "Payload invalido.");
            return;
        }
        if (port < 1 || port > 65535) {
            setFormError("Porta invalida.");
            return;
        }

        setFormError(null);

        try {
            const integration = await createIntegration({
                name: "Central Intelbras AMT 8000 PRO",
                type: "intelbras_amt8000",
                config: {
                    ip: parsed.data.ip,
                    port,
                    password: parsed.data.password,
                } as unknown as JSON,
            });
            setIntegrationId(integration.id);
            toast.success("Central Intelbras conectada com sucesso");
            setShowScanDialog(true);
        } catch (error) {
            setFormError(error instanceof Error && error.message ? error.message : "Erro inesperado ao conectar na central.");
        }
    };

    return (
        <>
            <Dialog open={open && !showScanDialog} onOpenChange={onOpenChange}>
                <DialogContent className="sm:max-w-sm">
                    <form onSubmit={handleSubmit}>
                        <DialogHeader>
                            <DialogTitle>Intelbras AMT 8000</DialogTitle>
                            <DialogDescription>
                                Conecte na central local via ISECNet v2 para importar status, particoes e zonas.
                            </DialogDescription>
                        </DialogHeader>
                        <FieldGroup className="py-6">
                            <Field>
                                <Label htmlFor="amt8000-ip">IP</Label>
                                <Input
                                    id="amt8000-ip"
                                    value={values.ip}
                                    disabled={isPending}
                                    aria-invalid={Boolean(error)}
                                    onChange={(event) => {
                                        setValues((current) => ({ ...current, ip: event.target.value }));
                                        setFormError(null);
                                    }}
                                />
                            </Field>
                            <Field>
                                <Label htmlFor="amt8000-port">Porta</Label>
                                <Input
                                    id="amt8000-port"
                                    inputMode="numeric"
                                    value={values.port}
                                    disabled={isPending}
                                    aria-invalid={Boolean(error)}
                                    onChange={(event) => {
                                        setValues((current) => ({ ...current, port: event.target.value }));
                                        setFormError(null);
                                    }}
                                />
                            </Field>
                            <Field>
                                <Label htmlFor="amt8000-password">Senha da central</Label>
                                <Input
                                    id="amt8000-password"
                                    type="password"
                                    inputMode="numeric"
                                    value={values.password}
                                    disabled={isPending}
                                    aria-invalid={Boolean(error)}
                                    onChange={(event) => {
                                        setValues((current) => ({ ...current, password: event.target.value }));
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
            <ScanDevicesDialog
                open={showScanDialog}
                onOpenChange={(nextOpen) => {
                    setShowScanDialog(nextOpen);
                    if (!nextOpen) onOpenChange(false);
                }}
                provider="intelbras_amt8000"
                integrationId={integrationId ?? undefined}
            />
        </>
    )
}
