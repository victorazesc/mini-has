import { IconName } from "lucide-react/dynamic"
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