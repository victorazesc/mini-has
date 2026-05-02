import { TuyaIntegrationDialog } from "./tuya-integration-dialog"

export function IntegrationProviderHandler({ provider }: { provider: string }) {
    if (provider === "tuya_cloud") {
        return <TuyaIntegrationDialog open={true} />
    }
}