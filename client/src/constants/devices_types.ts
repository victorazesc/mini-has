import { IconName } from "lucide-react/dynamic"
import { Lightbulb, Power, Brain, Camera, PawPrint, Blinds, Snowflake } from "lucide-react"

export type SmartThingsValue<T = unknown> = {
    value: T;
    unit?: string;
    timestamp?: string;
};

export type SmartThingsMainStatus = {
    switch?: {
        switch?: SmartThingsValue<"on" | "off">;
    };

    airConditionerMode?: {
        airConditionerMode?: SmartThingsValue<string>;
        availableAcModes?: SmartThingsValue<string[]>;
        supportedAcModes?: SmartThingsValue<string[]>;
    };

    airConditionerFanMode?: {
        fanMode?: SmartThingsValue<string>;
        availableAcFanModes?: SmartThingsValue<string[]>;
        supportedAcFanModes?: SmartThingsValue<string[]>;
    };

    fanOscillationMode?: {
        fanOscillationMode?: SmartThingsValue<string>;
        supportedFanOscillationModes?: SmartThingsValue<string[]>;
    };

    thermostatCoolingSetpoint?: {
        coolingSetpoint?: SmartThingsValue<number>;
        coolingSetpointRange?: SmartThingsValue<{
            minimum: number;
            maximum: number;
            step: number;
        }>;
    };

    temperatureMeasurement?: {
        temperature?: SmartThingsValue<number>;
    };

    relativeHumidityMeasurement?: {
        humidity?: SmartThingsValue<number>;
    };

    "custom.airConditionerOptionalMode"?: {
        acOptionalMode?: SmartThingsValue<string>;
        supportedAcOptionalMode?: SmartThingsValue<string[]>;
    };
} & Record<string, unknown>;

export type SmartThingsRawStatus = {
    components?: {
        main?: SmartThingsMainStatus;
    };
} & Record<string, unknown>;

export type DeviceStatus = {
    raw?: SmartThingsRawStatus;
    online: boolean;
    state: string;
    dps?: Record<string, unknown>;
    lastSeenAt?: string;
};


export const DEVICE_TYPES: { label: string, value: string, icon: IconName}[] = [
    {
        label: "Lampada",
        value: "LAMP",
        icon: 'lightbulb',
    },
    {
        label: "Camera",
        value: "CAM",
        icon: 'camera',
    },
    {
        label: "Alimentador de Gatos",
        value: "feeder",
        icon: 'paw-print',
    },
    {
        label: "Persiana",
        value: "cover",
        icon: 'blinds',
    },
    {
        label: "Climatizacao",
        value: "climate",
        icon: 'snowflake',
    }
]

export const DEVICE_ICON_BY_TYPE = {
    LAMP: Lightbulb,
    switch: Power,
    iot: Brain,
    CAM: Camera,
    FEEDER: PawPrint,
    CURTAIN: Blinds,
    cover: Blinds,
    climate: Snowflake,
}

export const DEVICE_TYPES_NAME_BY_TYPE = {
    LAMP: "Lampada",
    CAM: "Camera",
    FEEDER: "Alimentador de Gatos",
    CURTAIN: "Persiana",
    cover: "Persiana",
    climate: "Climatizacao",
}
