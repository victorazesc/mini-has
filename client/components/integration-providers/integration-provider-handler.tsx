import { TuyaIntegrationDialog } from "./tuya-integration-dialog"
import { SmartThingsIntegrationDialog } from "./smartthings-integration-dialog"
import { MqttIntegrationDialog } from "./mqtt-integration-dialog"
import { Amt8000IntegrationDialog } from "./amt8000-integration-dialog"

export function IntegrationProviderHandler({ provider }: { provider: string }) {
    if (provider === "tuya_cloud") {
        return <TuyaIntegrationDialog open={true} />
    }

    if (provider === "smartthings_cloud") {
        return <SmartThingsIntegrationDialog open={true} />
    }

    if (provider === "mqtt") {
        return <MqttIntegrationDialog open={true} />
    }

    if (provider === "intelbras_amt8000") {
        return <Amt8000IntegrationDialog open={true} />
    }
}
