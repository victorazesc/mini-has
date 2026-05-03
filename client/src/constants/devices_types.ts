import { IconName } from "lucide-react/dynamic"
import { Lightbulb, Power, Brain, Camera, PawPrint, Blinds, Snowflake } from "lucide-react"
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
        value: "CURTAIN",
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
    climate: Snowflake,
}

export const DEVICE_TYPES_NAME_BY_TYPE = {
    LAMP: "Lampada",
    CAM: "Camera",
    FEEDER: "Alimentador de Gatos",
    CURTAIN: "Persiana",
    climate: "Climatizacao",
}