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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useIntegrations } from "@/hooks/use-integrations"
import { useState } from "react"
import { toast } from "sonner"
import { z } from "zod"
import { ScanDevicesDialog } from "../scan-devices-dialog"

const schema = z.object({
    appId: z.string().trim().min(1, "App ID e obrigatorio"),
    appSecret: z.string().trim().min(1, "App Secret e obrigatorio"),
    email: z.string().trim().email("E-mail invalido"),
    password: z.string().min(1, "Senha e obrigatoria"),
    moduleCount: z.string().regex(/^\d+$/, "Quantidade de modulos invalida"),
});

export function IntelbrasSolarIntegrationDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
    const [values, setValues] = useState<z.infer<typeof schema>>({
        appId: "",
        appSecret: "",
        email: "",
        password: "",
        moduleCount: "4",
    });
    const [formError, setFormError] = useState<string | null>(null);
    const [showScanDialog, setShowScanDialog] = useState(false);
    const [integrationId, setIntegrationId] = useState<number | null>(null);
    const { mutateAsync: createIntegration, isPending } = useIntegrations();

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const parsed = schema.safeParse(values);
        if (!parsed.success) {
            setFormError(parsed.error.issues[0]?.message ?? "Payload invalido.");
            return;
        }
        const moduleCount = Number(parsed.data.moduleCount);
        if (moduleCount < 1 || moduleCount > 16) {
            setFormError("Informe entre 1 e 16 modulos.");
            return;
        }

        try {
            const integration = await createIntegration({
                name: "Intelbras Solar Send",
                type: "intelbras_solar",
                config: { ...parsed.data, moduleCount } as unknown as JSON,
            });
            setIntegrationId(integration.id);
            toast.success("Intelbras Solar conectado com sucesso");
            setShowScanDialog(true);
        } catch (error) {
            setFormError(error instanceof Error ? error.message : "Erro ao conectar no Intelbras Solar.");
        }
    };

    const setValue = (key: keyof typeof values, value: string) => {
        setValues((current) => ({ ...current, [key]: value }));
        setFormError(null);
    };

    return (
        <>
            <Dialog open={open && !showScanDialog} onOpenChange={onOpenChange}>
                <DialogContent className="sm:max-w-md">
                    <form onSubmit={handleSubmit}>
                        <DialogHeader>
                            <DialogTitle>Intelbras Solar Send</DialogTitle>
                            <DialogDescription>
                                Importe o microinversor e monitore individualmente seus modulos via API Solarman.
                            </DialogDescription>
                        </DialogHeader>
                        <FieldGroup className="py-6">
                            <SolarField id="solar-app-id" label="Solarman App ID" value={values.appId} disabled={isPending} onChange={(value) => setValue("appId", value)} />
                            <SolarField id="solar-app-secret" label="Solarman App Secret" type="password" value={values.appSecret} disabled={isPending} onChange={(value) => setValue("appSecret", value)} />
                            <SolarField id="solar-email" label="E-mail da conta Solar Send" type="email" value={values.email} disabled={isPending} onChange={(value) => setValue("email", value)} />
                            <SolarField id="solar-password" label="Senha da conta" type="password" value={values.password} disabled={isPending} onChange={(value) => setValue("password", value)} />
                            <SolarField id="solar-modules" label="Quantidade de modulos" value={values.moduleCount} disabled={isPending} onChange={(value) => setValue("moduleCount", value)} />
                        </FieldGroup>
                        <FieldError className="mb-6 w-full text-center">{formError}</FieldError>
                        <p className="mb-6 text-xs text-muted-foreground">
                            Integracao somente leitura. App ID e App Secret devem ser solicitados no portal OpenAPI Solarman.
                        </p>
                        <DialogFooter>
                            <DialogClose render={<Button variant="outline" disabled={isPending}>Cancelar</Button>} />
                            <Button type="submit" disabled={isPending}>{isPending ? "Conectando..." : "Conectar"}</Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
            <ScanDevicesDialog open={showScanDialog} onOpenChange={(nextOpen) => {
                setShowScanDialog(nextOpen);
                if (!nextOpen) onOpenChange(false);
            }} provider="intelbras_solar" integrationId={integrationId ?? undefined} />
        </>
    )
}

function SolarField({ id, label, value, disabled, onChange, type = "text" }: { id: string; label: string; value: string; disabled: boolean; onChange: (value: string) => void; type?: string }) {
    return (
        <Field>
            <Label htmlFor={id}>{label}</Label>
            <Input id={id} type={type} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
        </Field>
    );
}
