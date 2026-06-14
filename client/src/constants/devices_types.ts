import { IconName } from "lucide-react/dynamic"
import { Lightbulb, Power, Brain, Camera, PawPrint, Blinds, Snowflake, Shield, Sun, Printer } from "lucide-react"

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


export const DEVICE_TYPES: { label: string, value: string, icon: IconName }[] = [
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
    },
    {
        label: "Central de alarme",
        value: "alarm",
        icon: 'shield',
    },
    {
        label: "Impressora 3D",
        value: "printer",
        icon: 'printer',
    }
]

export const DEVICE_ICON_BY_TYPE = {
    light: Lightbulb,
    switch: Power,
    iot: Brain,
    cam: Camera,
    camera: Camera,
    feeder: PawPrint,
    curtain: Blinds,
    cover: Blinds,
    climate: Snowflake,
    alarm: Shield,
    solar_inverter: Sun,
    printer: Printer,
}

export const DEVICE_TYPES_NAME_BY_TYPE = {
    LAMP: "Lampada",
    light: "Lâmpada",
    switch: "Interruptor",
    switch2ch: "Interruptor duplo",
    iot: "Hub",
    cam: "Camera",
    camera: "Camera",
    feeder: "Alimentador de Gatos",
    curtain: "Persiana",
    cover: "Persiana",
    climate: "Climatizacao",
    alarm: "Central de alarme",
    solar_inverter: "Microinversor solar",
    printer: "Impressora 3D",
}

export function deviceImageSrc(deviceType: string): string {
    const normalizedType = String(deviceType || "").trim().toLowerCase();

    if (["lamp", "light", "lightbulb"].includes(normalizedType)) return "/devices/light.png";
    if (["cam", "camera"].includes(normalizedType)) return "/devices/camera.png";
    if (["curtain", "cover", "blind", "blinds"].includes(normalizedType)) return "/devices/cover.png";
    if (["feeder"].includes(normalizedType)) return "/devices/feeder.png";
    if (["climate", "air_conditioner", "air-conditioner"].includes(normalizedType)) return "/devices/climate.png";
    if (["printer", "3d_printer"].includes(normalizedType)) return "/devices/printer.png";
    if (["alarm", "alarme"].includes(normalizedType)) return "/devices/alarm.png";
    if (["iot", "hub", "gateway"].includes(normalizedType)) return "/devices/iot.png";
    if (["switch2ch", "switch_2ch"].includes(normalizedType)) return "/devices/switch2ch.png";
    return "/devices/switch.png";
}
