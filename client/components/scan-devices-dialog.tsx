import { useInboxDevices } from "@/hooks/use-inbox-devices";
import { useSyncIntegration } from "@/hooks/use-integrations";
import { PROVIDERS } from "@/src/constants/providers";
import { Dialog, DialogTrigger, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import { DialogContent, DialogHeader } from "./ui/dialog";
import { Button } from "./ui/button";
import { DiscoveredDeviceCard } from "./discovered-device-card";
import { useRooms } from "@/hooks/use-rooms";

export function ScanDevicesDialog({
    children,
    provider,
    integrationId,
}: {
    children: React.ReactElement;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    provider: string;
    integrationId?: number;
}) {

    const providerName =
        PROVIDERS.find((p) => p.value === provider)?.label ?? "DIY";

    const {
        mutateAsync: syncIntegration,
        isPending: isPendingSyncIntegration,
    } = useSyncIntegration();

    const {
        data: inboxDevices,
        isLoading: isLoadingInboxDevices,
        error: errorInboxDevices,
    } = useInboxDevices({
        status: "pending",
        provider,
    });

    const {
        data: rooms,
        isLoading: isLoadingRooms,
        error: errorRooms,
    } = useRooms();

    const handleSyncIntegration = async () => {
        try {
            if (!integrationId) {
                toast.error("ID da integração não informado");
                return;
            }
            await syncIntegration(integrationId);
            toast.success("Integração sincronizada com sucesso");
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : "Erro ao sincronizar integração"
            );
        }
    };

    const devices = inboxDevices ?? [];

    return (
        <Dialog>
            <DialogTrigger render={children as React.ReactElement} nativeButton={false} />

            <DialogContent className="max-w-screen min-w-full h-screen content-start">
                <Button
                    onClick={handleSyncIntegration}
                    disabled={isPendingSyncIntegration}
                    variant="outline"
                    size="sm"
                    className="absolute top-4 right-16 z-10"
                >
                    {isPendingSyncIntegration ? "Sincronizando..." : "Reescanear"}
                </Button>

                <DialogHeader>
                    <DialogTitle>Dispositivos encontrados</DialogTitle>
                    <DialogDescription>
                        Revise os dispositivos encontrados via {providerName} antes de
                        adicioná-los ao Mini HAS.
                    </DialogDescription>
                </DialogHeader>

                {isLoadingInboxDevices && (
                    <div className="py-10 text-center text-sm text-muted-foreground">
                        Buscando dispositivos...
                    </div>
                )}

                {errorInboxDevices && (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
                        Erro ao buscar dispositivos pendentes.
                    </div>
                )}

                {!isLoadingInboxDevices && devices.length === 0 && (
                    <div className="rounded-lg border border-dashed p-8 text-center">
                        <p className="text-sm font-medium">
                            Nenhum dispositivo pendente encontrado
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                            Tente sincronizar novamente a integração.
                        </p>
                    </div>
                )}

                <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3">
                    {devices.map((device) => (
                        <DiscoveredDeviceCard key={device.id} device={device} onAddDevice={() => { }} onIgnoreDevice={() => { }} rooms={rooms ?? []} />
                    ))}
                </section>
            </DialogContent>
        </Dialog>
    );
}