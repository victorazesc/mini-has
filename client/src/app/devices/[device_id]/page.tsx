"use client"
import { Button } from "@/components/ui/button";
import { useDevice, useSendCommand } from "@/hooks/use-devices";
import { cn } from "@/lib/utils";
import { Circle, Settings2 } from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect } from "react";
import { useHeaderTitle } from "@/src/providers/header-title-provider";
import { Card, CardContent } from "@/components/ui/card";
import { Device } from "@/src/services/devices.service";

type SwitchChannel = {
    dpsId: string;
    label: string;
    value: boolean;
};

function getSwitchChannels(device: Device): SwitchChannel[] {
    const statusEntries = Array.isArray(device.capabilities?.status)
        ? device.capabilities.status
        : [];
    const runtimeDps = device.status?.dps ?? {};

    return statusEntries
        .filter((entry): entry is { code: string; value: boolean } => {
            if (!entry || typeof entry !== "object") {
                return false;
            }

            const candidate = entry as { code?: unknown; value?: unknown };

            return (
                typeof candidate.code === "string" &&
                candidate.code.startsWith("switch_") &&
                typeof candidate.value === "boolean"
            );
        })
        .map((entry) => {
            const dpsId = entry.code.replace("switch_", "");
            const runtimeValue = runtimeDps[dpsId];

            return {
                dpsId,
                label: `Switch ${dpsId}`,
                value: typeof runtimeValue === "boolean" ? runtimeValue : entry.value,
            };
        });
}

export default function DevicePage() {
    const { device_id } = useParams();
    const { data: device } = useDevice(parseInt(device_id as string));
    const { mutate: sendCommand } = useSendCommand();
    const { setTitle, setRightAction } = useHeaderTitle();
    const deviceName = device?.name ?? "";
    const deviceRoomName = device?.roomName ?? "";
    const deviceOnline = device?.status?.online ?? false;

    const handleToggle = (
        deviceId: number,
        dpsId: string | number,
        currentValue: boolean

    ) => {

        sendCommand({
            deviceId,
            command: {
                command: "set",
                params: {
                    dpsId,
                    value: !currentValue,
                },
            },
        });
    };
    useEffect(() => {
        setTitle(
            <span className="flex items-center gap-2">
                {deviceOnline ?
                    <span className="flex items-center gap-2 text-green-500">
                        <Circle size={12} fill="green" />
                    </span> : <span className="flex items-center gap-2 text-red-500">
                        <Circle size={12} fill="red" />
                    </span>}
                {deviceName}
                <span className="text-muted-foreground">
                    <span className="text-muted-foreground">
                        • {deviceRoomName}
                    </span>
                </span>
            </span>);
        setRightAction(
            <Button variant="outline" size="sm">
                <Settings2 className="size-4" />
                Configuração
            </Button>
        );

        return () => {
            setTitle(null);
            setRightAction(null);
        };
    }, [deviceName, deviceRoomName, deviceOnline, setRightAction, setTitle]);

    if (!device) {
        return <div>Device not found</div>;
    }

    const switchChannels = getSwitchChannels(device);

    return (
        <main className="flex flex-1 flex-col px-4 lg:px-6">
            <div className="@container/main flex flex-1 flex-col gap-2 space-y-4 items-center justify-center w-full min-h-[calc(100vh-120px)]">
                <div className="flex flex-row gap-6 justify-center">
                    {switchChannels.map((channel) => (
                        <div key={channel.dpsId} className="flex flex-col gap-2 items-center">
                            <p className="text-lg font-medium text-center text-muted-foreground">{channel.label}</p>
                            <Card
                                key={channel.dpsId}
                                className="h-[360px] w-[460px] shrink-0 cursor-pointer py-0 shadow-2xl transition-transform duration-200 ease-out transform-[scale(1)] hover:transform-[scale(1.02)] active:transform-[scale(0.985)]"
                                onClick={() => handleToggle(device.id, channel.dpsId, channel.value)}
                            >
                                <CardContent className="flex flex-col h-full justify-center gap-2 px-6">
                                    <Circle className={cn("size-4", channel.value ? "fill-primary text-primary" : "fill-secondary text-secondary")} />
                                    <Circle className={cn("size-4", channel.value ? "fill-primary text-primary" : "fill-secondary text-secondary")} />
                                    <Circle className={cn("size-4", channel.value ? "fill-primary text-primary" : "fill-secondary text-secondary")} />
                                </CardContent>
                            </Card>
                        </div>
                    ))}
                </div>
            </div>
        </main>
    )
}