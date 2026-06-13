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
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "../ui/select"
import { ScanDevicesDialog } from "../scan-devices-dialog"

const schema = z.object({
    accessId: z.string().min(1, "Cliente ID e obrigatorio"),
    accessSecret: z.string().min(1, "Secret Key e obrigatoria"),
    region: z.string().min(1, "Regiao e obrigatoria"),
});

export function TuyaIntegrationDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
    const [values, setValues] = useState<z.infer<typeof schema>>({
        accessId: "",
        accessSecret: "",
        region: "",
    });
    const [formError, setFormError] = useState<string | null>(null);
    const [showScanDialog, setShowScanDialog] = useState(false);
    const [integrationId, setIntegrationId] = useState<number | null>(null);
    const { mutateAsync: createIntegration, isPending, error } = useIntegrations();

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        const parsed = schema.safeParse(values);

        if (!parsed.success) {
            setFormError(parsed.error.message);
            return;
        }

        setFormError(null);

        try {
            const integration = await createIntegration({
                name: "Tuya Cloud",
                type: "tuya_cloud",
                config: {
                    accessId: parsed.data.accessId,
                    accessSecret: parsed.data.accessSecret,
                    region: parsed.data.region,
                } as unknown as JSON,
            });
            setIntegrationId(integration.id);
            toast.success("Integração Tuya Cloud criada com sucesso");
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
            <Dialog open={open && !showScanDialog} onOpenChange={onOpenChange}>
                <DialogContent className="sm:max-w-sm">
                    <form onSubmit={handleSubmit}>
                        <DialogHeader>
                            <DialogTitle>Integração Tuya</DialogTitle>
                            <DialogDescription>
                                Adicione seu cliente ID e secret key para a integração Tuya.
                            </DialogDescription>
                        </DialogHeader>
                        <FieldGroup className="py-6">
                            <Field>
                                <Label htmlFor="clientId">Cliente ID</Label>
                                <Input
                                    id="clientId"
                                    name="clientId"
                                    placeholder="Digite seu cliente ID"
                                    disabled={isPending}
                                    aria-invalid={Boolean(error)}
                                    value={values.accessId}
                                    onChange={(event) => {
                                        setValues((prev) => ({ ...prev, accessId: event.target.value }));
                                    }}
                                />
                            </Field>
                            <Field>
                                <Label htmlFor="secretKey">Secret Key</Label>
                                <Input
                                    id="secretKey"
                                    name="secretKey"
                                    placeholder="Digite sua secret key"
                                    disabled={isPending}
                                    aria-invalid={Boolean(error)}
                                    value={values.accessSecret}
                                    onChange={(event) => {
                                        setValues((prev) => ({ ...prev, accessSecret: event.target.value }));
                                    }}
                                />
                            </Field>
                            <Field>
                                <Label htmlFor="region">Regiao</Label>
                                <Select
                                    id="region"
                                    name="region"
                                    value={values.region}
                                    onValueChange={(value) => setValues((prev) => ({ ...prev, region: value as "eastern-america" | "western-america" | "central-europe" | "western-europe" | "india" | "china" }))}
                                >
                                    <SelectTrigger className="w-full">
                                        <SelectValue placeholder="Regiao" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectGroup>
                                            <SelectItem value="eastern-america">Eastern America</SelectItem>
                                            <SelectItem value="western-america">Western America</SelectItem>
                                            <SelectItem value="central-europe">Central Europe</SelectItem>
                                            <SelectItem value="western-europe">Western Europe</SelectItem>
                                            <SelectItem value="india">India</SelectItem>
                                            <SelectItem value="china">China</SelectItem>
                                        </SelectGroup>
                                    </SelectContent>
                                </Select>
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
            <ScanDevicesDialog open={showScanDialog} onOpenChange={(nextOpen) => {
                setShowScanDialog(nextOpen);
                if (!nextOpen) onOpenChange(false);
            }} provider="tuya_cloud" integrationId={integrationId ?? undefined} />
        </>
    )
}
