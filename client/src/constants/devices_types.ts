import { IconName } from "lucide-react/dynamic"
import { Lightbulb, Power, Brain, Camera, PawPrint, Blinds } from "lucide-react"
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
        value: "FEEDER",
        icon: 'paw-print',
    },
    {
        label: "Persiana",
        value: "CURTAIN",
        icon: 'blinds',
    }
]

export const DEVICE_ICON_BY_TYPE = {
    LAMP: Lightbulb,
    switch: Power,
    iot: Brain,
    CAM: Camera,
    FEEDER: PawPrint,
    CURTAIN: Blinds,
}