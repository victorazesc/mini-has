import { Device } from "@/src/services/devices.service"
import { NextRequest, NextResponse } from "next/server"

const filteredDevices = (device: Device, selectedType: string, search: string) => {
    const matchesType = selectedType === "all" || device.type === selectedType
    const matchesSearch =
        !search ||
        device.name.toLowerCase().includes(search) ||
        device.room.toLowerCase().includes(search) ||
        device.provider.toLowerCase().includes(search)

    return matchesType && matchesSearch
}

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url)
    const name = searchParams.get("name")
    const type = searchParams.get("type")
    console.log(name, type)

    const devices: Device[] = [
        {
            id: "1",
            name: "Churrasqueira",
            provider: "Tuya",
            type: "LAMP",
            status: "ONLINE",
            active: true,
            room: "Cozinha",
        },
        {
            id: "2",
            name: "Interruptor Escritório 1",
            provider: "Tuya",
            type: "LAMP",
            status: "ONLINE",
            active: true,
            room: "Escritório",
        },
        {
            id: "3",
            name: "Interruptor Escritório 2",
            provider: "Tuya",
            type: "LAMP",
            status: "ONLINE",
            active: true,
            room: "Escritório",
        },
        {
            id: "4",
            name: "Câmera da Frente",
            provider: "INTELBRAS",
            type: "CAM",
            status: "ONLINE",
            active: true,
            room: "Área externa",
        },
        {
            id: "5",
            name: "Câmera dos Fundos",
            provider: "INTELBRAS",
            type: "CAM",
            status: "ONLINE",
            active: true,
            room: "Área externa",
        },
        {
            id: "6",
            name: "Alimentador de Gatos",
            provider: "TUYA",
            type: "FEEDER",
            status: "ONLINE",
            active: true,
            room: "Cozinha",
        },
        {
            id: "7",
            name: "Persiana",
            provider: "DIY",
            type: "CURTAIN",
            status: "ONLINE",
            active: true,
            room: "Escritório",
        },
    ]

    if (name || type) {
        return NextResponse.json(devices.filter((device) => filteredDevices(device, type ?? "all", name ?? "")))
    }

    return NextResponse.json(devices)
}