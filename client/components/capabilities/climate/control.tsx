import { ClimateDial, ClimateFanDirection, ClimateFanMode, ClimateMode, ClimatePredefinedMode } from "./climateDial"
import { useEffect, useRef, useState } from "react"
import { CommandResult, Device } from "@/src/services/devices.service"
import { DeviceStatus } from "@/src/constants/devices_types"
import { useSendCommand } from "@/hooks/use-devices"

const MODE_TEMPERATURE_FALLBACKS: Partial<Record<ClimateMode, number>> = {
    cool: 19,
    dry: 24,
};

type ExpectedClimateState = Partial<{
    mode: ClimateMode;
    fanMode: ClimateFanMode;
    fanDirection: ClimateFanDirection;
    predefinedMode: ClimatePredefinedMode;
}>;

export function ClimateControl({ device, compact = false }: { device: Device & { status: DeviceStatus }; compact?: boolean }) {
    const mainStatus = device.status?.raw?.components?.main;
    const coolingSetpoint = Number(mainStatus?.thermostatCoolingSetpoint?.coolingSetpoint?.value);
    const coolingRange = mainStatus?.thermostatCoolingSetpoint?.coolingSetpointRange?.value;
    const minTemperature = Number(coolingRange?.minimum ?? 16);
    const maxTemperature = Number(coolingRange?.maximum ?? 30);
    const initialTemperature = Number.isFinite(coolingSetpoint) ? coolingSetpoint : minTemperature;
    const measuredTemperature = Number(mainStatus?.temperatureMeasurement?.temperature?.value);
    const currentTemperature = Number.isFinite(measuredTemperature) ? measuredTemperature : null;
    const switchState = mainStatus?.switch?.switch?.value;
    const initialMode = switchState === "off" ? "off" : ((mainStatus?.airConditionerMode?.airConditionerMode?.value as ClimateMode) ?? "off");
    const initialFanMode = (mainStatus?.airConditionerFanMode?.fanMode?.value as ClimateFanMode) ?? "auto";
    const initialFanDirection = (mainStatus?.fanOscillationMode?.fanOscillationMode?.value as ClimateFanDirection) ?? "fixed";
    const initialPredefinedMode = (mainStatus?.["custom.airConditionerOptionalMode"]?.acOptionalMode?.value as ClimatePredefinedMode) ?? "none";

    const [temperatureOverride, setTemperatureOverride] = useState<number | null>(null)
    const [modeOverride, setModeOverride] = useState<ClimateMode | null>(null)
    const [fanModeOverride, setFanModeOverride] = useState<ClimateFanMode | null>(null)
    const [fanDirectionOverride, setFanDirectionOverride] = useState<ClimateFanDirection | null>(null)
    const [predefinedModeOverride, setPredefinedModeOverride] = useState<ClimatePredefinedMode | null>(null)
    const refreshTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
    const clearOptimisticTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const modeTemperatureRef = useRef<Partial<Record<ClimateMode, number>>>({});
    const { mutate: sendCommand } = useSendCommand();

    const temperature = temperatureOverride ?? initialTemperature;
    const mode = modeOverride ?? initialMode;
    const fanMode = fanModeOverride ?? initialFanMode;
    const fanDirection = fanDirectionOverride ?? initialFanDirection;
    const predefinedMode = predefinedModeOverride ?? initialPredefinedMode;

    useEffect(() => {
        if (Number.isFinite(initialTemperature)) {
            modeTemperatureRef.current[initialMode] = initialTemperature;
        }
    }, [initialMode, initialTemperature]);

    useEffect(() => {
        return () => {
            refreshTimeoutsRef.current.forEach(clearTimeout);
            if (clearOptimisticTimeoutRef.current) {
                clearTimeout(clearOptimisticTimeoutRef.current);
            }
        };
    }, []);

    const clearOptimisticState = () => {
        setTemperatureOverride(null);
        setModeOverride(null);
        setFanModeOverride(null);
        setFanDirectionOverride(null);
        setPredefinedModeOverride(null);
    }

    const clampTemperature = (value: number) => {
        return Math.min(Math.max(value, minTemperature), maxTemperature);
    }

    const getOptimisticTemperatureForMode = (nextMode: ClimateMode) => {
        const learnedTemperature = modeTemperatureRef.current[nextMode];
        const fallbackTemperature = MODE_TEMPERATURE_FALLBACKS[nextMode];
        const nextTemperature = learnedTemperature ?? fallbackTemperature ?? temperature;

        return clampTemperature(nextTemperature);
    }

    const applyQueryResult = (result: CommandResult, expectedState?: ExpectedClimateState) => {
        const rawStatus = result.result.rawStatus as DeviceStatus["raw"] | undefined;
        const nextMainStatus = rawStatus?.components?.main;
        const nextTemperature = Number(nextMainStatus?.thermostatCoolingSetpoint?.coolingSetpoint?.value);
        const nextSwitchState = nextMainStatus?.switch?.switch?.value;
        const nextMode = nextSwitchState === "off" ? "off" : nextMainStatus?.airConditionerMode?.airConditionerMode?.value as ClimateMode | undefined;
        const nextFanMode = nextMainStatus?.airConditionerFanMode?.fanMode?.value as ClimateFanMode | undefined;
        const nextFanDirection = nextMainStatus?.fanOscillationMode?.fanOscillationMode?.value as ClimateFanDirection | undefined;
        const nextPredefinedMode = nextMainStatus?.["custom.airConditionerOptionalMode"]?.acOptionalMode?.value as ClimatePredefinedMode | undefined;

        if (
            (expectedState?.mode && nextMode && nextMode !== expectedState.mode)
            || (expectedState?.fanMode && nextFanMode && nextFanMode !== expectedState.fanMode)
            || (expectedState?.fanDirection && nextFanDirection && nextFanDirection !== expectedState.fanDirection)
            || (expectedState?.predefinedMode && nextPredefinedMode && nextPredefinedMode !== expectedState.predefinedMode)
        ) {
            return;
        }

        if (Number.isFinite(nextTemperature)) {
            setTemperatureOverride(nextTemperature);
            if (nextMode) {
                modeTemperatureRef.current[nextMode] = nextTemperature;
            }
        }
        if (nextMode) {
            setModeOverride(nextMode);
        }
        if (nextFanMode) {
            setFanModeOverride(nextFanMode);
        }
        if (nextFanDirection) {
            setFanDirectionOverride(nextFanDirection);
        }
        if (nextPredefinedMode) {
            setPredefinedModeOverride(nextPredefinedMode);
        }

        if (clearOptimisticTimeoutRef.current) {
            clearTimeout(clearOptimisticTimeoutRef.current);
        }
        clearOptimisticTimeoutRef.current = setTimeout(() => {
            clearOptimisticTimeoutRef.current = null;
            clearOptimisticState();
        }, 800);
    }

    const scheduleStatusRefresh = (expectedState?: ExpectedClimateState) => {
        refreshTimeoutsRef.current.forEach(clearTimeout);
        refreshTimeoutsRef.current = [];

        if (!device.id) {
            return;
        }

        refreshTimeoutsRef.current = [300, 1400].map((delay) => setTimeout(() => {
            sendCommand({
                deviceId: device.id,
                command: {
                    command: "query",
                    params: {},
                },
            }, {
                onSuccess: (result) => applyQueryResult(result, expectedState),
            });
        }, delay));
    }

    const sendClimateCommand = (
        capability: string,
        command: string,
        args: unknown[] = [],
        onError?: () => void,
        expectedState?: ExpectedClimateState
    ) => {
        if (!device.id) {
            return;
        }

        sendCommand({
            deviceId: device.id,
            command: {
                command: "custom",
                params: {
                    commands: [
                        {
                            component: "main",
                            capability,
                            command,
                            ...(args.length > 0 ? { arguments: args } : {}),
                        },
                    ],
                },
            },
        }, {
            onError,
            onSuccess: () => scheduleStatusRefresh(expectedState),
        });
    }

    const handlePreviewTemperature = (value: number) => {
        setTemperatureOverride(value);
    }

    const handleCommitTemperature = (value: number) => {
        const previousTemperature = temperature;

        setTemperatureOverride(value);
        sendClimateCommand("thermostatCoolingSetpoint", "setCoolingSetpoint", [value], () => {
            setTemperatureOverride(previousTemperature);
        });
    }

    const handleChangeMode = (nextMode: ClimateMode) => {
        const previousMode = mode;
        const previousTemperature = temperature;
        const optimisticTemperature = getOptimisticTemperatureForMode(nextMode);

        modeTemperatureRef.current[mode] = temperature;
        setModeOverride(nextMode);
        if (nextMode === "off") {
            sendClimateCommand(
                "switch",
                "off",
                [],
                () => {
                    setModeOverride(previousMode);
                    setTemperatureOverride(previousTemperature);
                },
                { mode: nextMode }
            );
            return;
        }

        setTemperatureOverride(optimisticTemperature);
        sendCommand({
            deviceId: device.id,
            command: {
                command: "custom",
                params: {
                    commands: [
                        {
                            component: "main",
                            capability: "switch",
                            command: "on",
                        },
                        {
                            component: "main",
                            capability: "airConditionerMode",
                            command: "setAirConditionerMode",
                            arguments: [nextMode],
                        },
                    ],
                },
            },
        }, {
            onError: () => {
                setModeOverride(previousMode);
                setTemperatureOverride(previousTemperature);
            },
            onSuccess: () => scheduleStatusRefresh({ mode: nextMode }),
        });
    }

    const handleChangeFanMode = (nextFanMode: ClimateFanMode) => {
        const previousFanMode = fanMode;

        setFanModeOverride(nextFanMode);
        sendClimateCommand(
            "airConditionerFanMode",
            "setFanMode",
            [nextFanMode],
            () => {
                setFanModeOverride(previousFanMode);
            },
            { fanMode: nextFanMode }
        );
    }

    const handleChangeFanDirection = (nextFanDirection: ClimateFanDirection) => {
        const previousFanDirection = fanDirection;

        setFanDirectionOverride(nextFanDirection);
        sendClimateCommand(
            "fanOscillationMode",
            "setFanOscillationMode",
            [nextFanDirection],
            () => {
                setFanDirectionOverride(previousFanDirection);
            },
            { fanDirection: nextFanDirection }
        );
    }

    const handleChangePredefinedMode = (nextPredefinedMode: ClimatePredefinedMode) => {
        const previousPredefinedMode = predefinedMode;

        setPredefinedModeOverride(nextPredefinedMode);
        sendClimateCommand(
            "custom.airConditionerOptionalMode",
            "setAcOptionalMode",
            [nextPredefinedMode],
            () => {
                setPredefinedModeOverride(previousPredefinedMode);
            },
            { predefinedMode: nextPredefinedMode }
        );
    }

    return (
        <ClimateDial
            compact={compact}
            isLoading={false}
            value={temperature}
            currentTemperature={currentTemperature}
            min={minTemperature}
            max={maxTemperature}
            status={mode}
            mode={mode}
            fanMode={fanMode}
            fanDirection={fanDirection}
            predefinedMode={predefinedMode}
            onChange={handlePreviewTemperature}
            onCommit={handleCommitTemperature}
            onChangeMode={handleChangeMode}
            onChangeFanMode={handleChangeFanMode}
            onChangeFanDirection={handleChangeFanDirection}
            onChangePredefinedMode={handleChangePredefinedMode}
        />
    )
}
