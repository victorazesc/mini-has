import { TuyaIntegrationDialog } from "./tuya-integration-dialog"
import { SmartThingsIntegrationDialog } from "./smartthings-integration-dialog"
import { MqttIntegrationDialog } from "./mqtt-integration-dialog"
import { Amt8000IntegrationDialog } from "./amt8000-integration-dialog"
import { IntelbrasSolarIntegrationDialog } from "./intelbras-solar-integration-dialog"
import { OnvifCameraIntegrationDialog } from "./onvif-camera-integration-dialog"

export function IntegrationProviderHandler({ provider, onOpenChange }: { provider: string; onOpenChange: (open: boolean) => void }) {
    if (provider === "tuya_cloud") {
        return <TuyaIntegrationDialog open={true} onOpenChange={onOpenChange} />
    }

    if (provider === "smartthings_cloud") {
        return <SmartThingsIntegrationDialog open={true} onOpenChange={onOpenChange} />
    }

    if (provider === "mqtt") {
        return <MqttIntegrationDialog open={true} onOpenChange={onOpenChange} />
    }

    if (provider === "intelbras_amt8000") {
        return <Amt8000IntegrationDialog open={true} onOpenChange={onOpenChange} />
    }

    if (provider === "intelbras_solar") {
        return <IntelbrasSolarIntegrationDialog open={true} onOpenChange={onOpenChange} />
    }

    if (provider === "onvif_camera") {
        return <OnvifCameraIntegrationDialog open={true} onOpenChange={onOpenChange} />
    }
}
