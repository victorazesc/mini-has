import { TuyaIntegrationDialog } from "./tuya-integration-dialog"
import { SmartThingsIntegrationDialog } from "./smartthings-integration-dialog"

export function IntegrationProviderHandler({ provider }: { provider: string }) {
    if (provider === "tuya_cloud") {
        return <TuyaIntegrationDialog open={true} />
    }

    if (provider === "smartthings_cloud") {
        return <SmartThingsIntegrationDialog open={true} />
    }
}