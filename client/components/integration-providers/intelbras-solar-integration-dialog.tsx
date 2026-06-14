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
import { Cloud, Database, ExternalLink, Info } from "lucide-react"
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
                <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg">
                    <form onSubmit={handleSubmit}>
                        <DialogHeader>
                            <DialogTitle>Intelbras Solar Send</DialogTitle>
                            <DialogDescription>
                                Importe o microinversor e monitore seus módulos pela OpenAPI Solarman.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="mt-5 space-y-3 rounded-xl border bg-muted/30 p-4 text-sm">
                            <p className="flex items-center gap-2 font-medium"><Info className="size-4" /> Antes de conectar</p>
                            <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
                                <li>Solicite acesso à OpenAPI Solarman para receber um App ID e App Secret.</li>
                                <li>Use o e-mail e a senha da conta onde sua planta aparece no Solar Send.</li>
                                <li>Informe quantos módulos/painéis deseja visualizar separadamente.</li>
                            </ol>
                            <a
                                className="inline-flex items-center gap-1 text-sm font-medium underline underline-offset-4"
                                href="https://helpcenter.solarmanpv.com/portal/en/kb/articles/i-want-to-open-api-how-can-i-open-api"
                                rel="noreferrer"
                                target="_blank"
                            >
                                Como solicitar App ID e App Secret <ExternalLink className="size-3.5" />
                            </a>
                        </div>
                        <FieldGroup className="py-6">
                            <SolarField id="solar-app-id" label="App ID da OpenAPI Solarman" value={values.appId} disabled={isPending} onChange={(value) => setValue("appId", value)} />
                            <SolarField id="solar-app-secret" label="App Secret da OpenAPI Solarman" type="password" value={values.appSecret} disabled={isPending} onChange={(value) => setValue("appSecret", value)} />
                            <SolarField id="solar-email" label="E-mail usado no Solar Send" type="email" value={values.email} disabled={isPending} onChange={(value) => setValue("email", value)} />
                            <SolarField id="solar-password" label="Senha usada no Solar Send" type="password" value={values.password} disabled={isPending} onChange={(value) => setValue("password", value)} />
                            <SolarField id="solar-modules" label="Quantidade de módulos/painéis" value={values.moduleCount} disabled={isPending} onChange={(value) => setValue("moduleCount", value)} />
                        </FieldGroup>
                        <FieldError className="mb-6 w-full text-center">{formError}</FieldError>
                        <div className="mb-6 grid gap-2 text-xs text-muted-foreground">
                            <p className="flex items-start gap-2"><Cloud className="mt-0.5 size-4 shrink-0" /> Leituras em tempo real dependem da internet e da nuvem Solarman.</p>
                            <p className="flex items-start gap-2"><Database className="mt-0.5 size-4 shrink-0" /> Sem internet, o Mini HAS continua mostrando a última leitura salva localmente.</p>
                        </div>
                        <DialogFooter>
                            <DialogClose render={<Button variant="outline" disabled={isPending}>Cancelar</Button>} />
                            <Button type="submit" disabled={isPending}>{isPending ? "Validando credenciais..." : "Validar e conectar"}</Button>
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
