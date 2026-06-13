import { Badge } from "@/components/ui/badge";
import type { Device } from "@/src/services/devices.service";
import { Cloud, Wifi, WifiOff } from "lucide-react";

export function DeviceConnectivityBadge({ device }: { device: Device }) {
    const connectivity = device.status.connectivity;

    if (connectivity?.offlineReady) {
        return (
            <Badge className="gap-1 border-green-500/40 text-green-500" title={`Transporte: ${connectivity.transport || "local"}`} variant="outline">
                <Wifi className="size-3" />
                Disponível offline
            </Badge>
        );
    }

    if (connectivity?.controlMode === "cloud") {
        return (
            <Badge className="gap-1 border-amber-500/40 text-amber-500" title={connectivity.reason} variant="outline">
                <Cloud className="size-3" />
                Somente cloud
            </Badge>
        );
    }

    return (
        <Badge className="gap-1 text-muted-foreground" title={connectivity?.reason} variant="outline">
            <WifiOff className="size-3" />
            Local indisponível
        </Badge>
    );
}
