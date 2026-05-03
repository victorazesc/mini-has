import { ClimateDial, ClimateFanDirection, ClimateFanMode, ClimateMode, ClimatePredefinedMode } from "./climateDial"
import { useState } from "react"
import { Device } from "@/src/services/devices.service"
import { DeviceStatus } from "@/src/constants/devices_types"
import { useSendCommand } from "@/hooks/use-devices"

export function ClimateControl({ device }: { device: Device & { status: DeviceStatus } }) {
    const [temperature, setTemperature] = useState(Number(device.status?.raw?.components?.main?.thermostatCoolingSetpoint?.coolingSetpoint?.value))
    const { mutate: sendCommand } = useSendCommand();

    const handleChangeTemperature = (value: number) => {
        setTemperature(value);
        sendCommand({
            deviceId: device?.id ?? 0,
            command: {
                command: {
                    "command": "custom",
                    "params": {
                        "commands": [
                            {
                                "component": "main",
                                "capability": "thermostatCoolingSetpoint",
                                "command": "setCoolingSetpoint",
                                "arguments": [value]
                            }
                        ]
                    }
                },
                params: {},
            },
        });
    }

    return (
        <ClimateDial
            value={temperature}
            min={Number(device.status?.raw?.components?.main?.thermostatCoolingSetpoint?.coolingSetpointRange?.value.minimum)}
            max={Number(device.status?.raw?.components?.main?.thermostatCoolingSetpoint?.coolingSetpointRange?.value.maximum)}
            status={device.status?.raw?.components?.main?.airConditionerMode?.airConditionerMode?.value as ClimateMode}
            mode={device.status?.raw?.components?.main?.airConditionerMode?.airConditionerMode?.value as ClimateMode}
            fanMode={device.status?.raw?.components?.main?.airConditionerFanMode?.fanMode?.value as ClimateFanMode}
            fanDirection={device.status?.raw?.components?.main?.fanOscillationMode?.fanOscillationMode?.value as ClimateFanDirection}
            predefinedMode={device.status?.raw?.components?.main?.["custom.airConditionerOptionalMode"]?.acOptionalMode?.value as ClimatePredefinedMode}
            onChange={handleChangeTemperature}
            onDecrease={() => setTemperature((prev) => Math.max(Number(device.status?.raw?.components?.main?.thermostatCoolingSetpoint?.coolingSetpointRange?.value.minimum), prev - 1))}
            onIncrease={() => setTemperature((prev) => Math.min(Number(device.status?.raw?.components?.main?.thermostatCoolingSetpoint?.coolingSetpointRange?.value.maximum), prev + 1))}
        />
    )
}