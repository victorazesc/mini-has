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
import { useState } from "react"

export function SmartThingsIntegrationDialog({ open }: { open: boolean }) {
    const [isRedirecting, setIsRedirecting] = useState(false);

    function handleConnect() {
        setIsRedirecting(true);
        window.location.href = "/api/auth/smartthings/connect";
    }

    return (
        <Dialog open={open}>
            <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                    <DialogTitle>Integração SmartThings</DialogTitle>
                    <DialogDescription>
                        Conecte sua conta Samsung para importar os dispositivos SmartThings.
                    </DialogDescription>
                </DialogHeader>

                <Button
                    type="button"
                    className="my-6 w-full"
                    onClick={handleConnect}
                    disabled={isRedirecting}
                >
                    {isRedirecting ? "Redirecionando..." : "Conectar com SmartThings"}
                </Button>

                <DialogFooter>
                    <DialogClose render={<Button variant="outline" disabled={isRedirecting}>Cancelar</Button>} />
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
