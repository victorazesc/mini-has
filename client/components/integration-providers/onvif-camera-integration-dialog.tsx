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
import { ScanDevicesDialog } from "../scan-devices-dialog"

export function OnvifCameraIntegrationDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
    const [values, setValues] = useState({
        subnetPrefix: "192.168.1",
    });
    const [formError, setFormError] = useState<string | null>(null);
    const [showScanDialog, setShowScanDialog] = useState(false);
    const [integrationId, setIntegrationId] = useState<number | null>(null);
    const { mutateAsync: createIntegration, isPending } = useIntegrations();

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!/^(\d{1,3}\.){2}\d{1,3}$/.test(values.subnetPrefix.trim())) {
            setFormError("Sub-rede invalida. Use o formato 192.168.1");
            return;
        }
        try {
            const integration = await createIntegration({
                name: "Cameras da rede",
                type: "onvif_camera",
                config: {
                    subnetPrefix: values.subnetPrefix.trim(),
                } as unknown as JSON,
            });
            setIntegrationId(integration.id);
            toast.success("Busca de cameras configurada");
            setShowScanDialog(true);
        } catch (error) {
            setFormError(error instanceof Error ? error.message : "Erro ao buscar cameras.");
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
                            <DialogTitle>Cameras ONVIF/RTSP</DialogTitle>
                            <DialogDescription>
                                Busca cameras IP na rede. Credenciais e stream são configurados individualmente em cada câmera.
                            </DialogDescription>
                        </DialogHeader>
                        <FieldGroup className="py-6">
                            <CameraField id="camera-subnet" label="Sub-rede" value={values.subnetPrefix} disabled={isPending} onChange={(value) => setValue("subnetPrefix", value)} />
                        </FieldGroup>
                        <FieldError className="mb-6 w-full text-center">{formError}</FieldError>
                        <p className="mb-6 text-xs text-muted-foreground">
                            Depois de aceitar uma câmera, abra suas configurações para informar usuário, senha e caminho RTSP.
                        </p>
                        <DialogFooter>
                            <DialogClose render={<Button variant="outline" disabled={isPending}>Cancelar</Button>} />
                            <Button type="submit" disabled={isPending}>{isPending ? "Buscando..." : "Buscar cameras"}</Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
            <ScanDevicesDialog open={showScanDialog} onOpenChange={(nextOpen) => {
                setShowScanDialog(nextOpen);
                if (!nextOpen) onOpenChange(false);
            }} provider="onvif_camera" integrationId={integrationId ?? undefined} />
        </>
    )
}

function CameraField({ id, label, value, disabled, onChange, type = "text" }: { id: string; label: string; value: string; disabled: boolean; onChange: (value: string) => void; type?: string }) {
    return (
        <Field>
            <Label htmlFor={id}>{label}</Label>
            <Input id={id} type={type} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
        </Field>
    );
}
