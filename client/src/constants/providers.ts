import path from "path"

export const PROVIDERS = [
    {
        label: "Tuya Cloud",
        value: "tuya_cloud",
        icon: "./providers/tuya.png",
    },
    {
        label: "Intelbras Izy",
        value: "intelbras_izy",
        icon: "./providers/intelbras.png",
    },
    {
        label: "SmartThings Cloud",
        value: "smartthings_cloud",
        icon: "./providers/smartthings.png",
    },
    {
        label: "DIY",
        value: "generic_iot",
        icon: "./providers/diy.png",
    },
    {
        label: "MQTT",
        value: "mqtt",
        icon: "./providers/mqtt.svg",
    },
]

export const PROVIDERS_ICON_BY_TYPE = {
    tuya_cloud: path.join(process.cwd(), "./providers/tuya.svg"),
    intelbras_izy: "./providers/intelbras.svg",
    smartthings_cloud: path.join(process.cwd(), "./providers/smartThings.svg"),
    generic_iot: path.join(process.cwd(), "./providers/diy.svg"),
    mqtt: path.join(process.cwd(), "./providers/mqtt.svg"),
}

export const PROVIDERS_NAME_BY_TYPE = {
    tuya_cloud: "Tuya",
    intelbras_izy: "Intelbras",
    smartthings_cloud: "SmartThings",
    generic_iot: "DIY",
    mqtt: "MQTT",
}