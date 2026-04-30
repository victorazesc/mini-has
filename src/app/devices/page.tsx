"use client"
import * as React from "react"
import { Badge } from "@/components/ui/badge"
import { Card, CardAction, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Separator } from "@/components/ui/separator"
import { DEVICE_TYPES } from "@/src/constants/devices_types"
import { Blinds, Camera, Lightbulb, PawPrint, PlusCircle, Router, SearchIcon, EllipsisVertical, Wifi, WifiOff } from "lucide-react"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import Image from "next/image"
import { DeviceCard } from "@/components/device-card"

const devices = [
  {
    name: "Churrasqueira",
    provider: "Tuya",
    type: "LAMP",
    status: "ONLINE",
    active: true,
    room: "Cozinha",
  },
  {
    name: "Interruptor Escritório 1",
    provider: "Tuya",
    type: "LAMP",
    status: "ONLINE",
    active: true,
    room: "Escritório",
  },
  {
    name: "Interruptor Escritório 2",
    provider: "Tuya",
    type: "LAMP",
    status: "ONLINE",
    active: true,
    room: "Escritório",
  },
  {
    name: "Câmera da Frente",
    provider: "INTELBRAS",
    type: "CAM",
    status: "ONLINE",
    active: true,
    room: "Área externa",
  },
  {
    name: "Câmera dos Fundos",
    provider: "INTELBRAS",
    type: "CAM",
    status: "ONLINE",
    active: true,
    room: "Área externa",
  },
  {
    name: "Alimentador de Gatos",
    provider: "TUYA",
    type: "FEEDER",
    status: "ONLINE",
    active: true,
    room: "Cozinha",
  },
  {
    name: "Persiana",
    provider: "DIY",
    type: "CURTAIN",
    status: "ONLINE",
    active: true,
    room: "Escritório",
  },

]

const deviceTypeOptions = [
  { label: "Todos os dispositivos", value: "all" },
  ...DEVICE_TYPES,
]

const DEVICE_ICON_BY_TYPE = {
  LAMP: Lightbulb,
  CAM: Camera,
  FEEDER: PawPrint,
  CURTAIN: Blinds,
}

const PROVIDERS_ICON_BY_TYPE = {
  TUYA: "./providers/tuya.svg",
  INTELBRAS: "./providers/intelbras.svg",
  SMARTTHINGS: "./providers/smartthings.svg",
  DIY: "./providers/diy.svg",
}

const PROVIDERS_NAME_BY_TYPE = {
  TUYA: "Tuya",
  INTELBRAS: "Intelbras",
  SMARTTHINGS: "SmartThings",
  DIY: "DIY",
}

export default function Devices() {
  const [query, setQuery] = React.useState("")
  const [selectedType, setSelectedType] = React.useState("all")
  const [activeDevices, setActiveDevices] = React.useState<Record<string, boolean>>(
    () => Object.fromEntries(devices.map((device) => [device.name, device.active]))
  )

  const filteredDevices = devices.filter((device) => {
    const matchesType = selectedType === "all" || device.type === selectedType
    const search = query.trim().toLowerCase()
    const matchesSearch =
      !search ||
      device.name.toLowerCase().includes(search) ||
      device.room.toLowerCase().includes(search) ||
      device.provider.toLowerCase().includes(search)

    return matchesType && matchesSearch
  })
  const activeCount = Object.values(activeDevices).filter(Boolean).length

  const handleActiveChange = (deviceName: string, active: boolean) => {
    setActiveDevices((current) => {
      const newState = { ...current }
      newState[deviceName] = active
      return newState
    })
    const device = devices.find((device) => device.name === deviceName)
    if (device) {
      device.active = active
    }
  } 

  return (
    <main className="flex flex-1 flex-col px-4 lg:px-6">
      <div className="@container/main flex flex-1 flex-col gap-2 space-y-4">
        {/* Status and IP */}
        <section className="flex flex-row gap-2">
          <Badge variant="outline">LAN Ativa</Badge>
          <Badge variant="outline">Atualizando em 30/04, 14:53</Badge>
          <Badge variant="outline">IP 192.168.1.136</Badge>
        </section>
        {/* Search and Filter */}
        <section className="flex flex-row gap-4 justify-between">
          <InputGroup>
            <InputGroupInput
              placeholder="Buscar dispositivos..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
          </InputGroup>
          <Select>
            <SelectTrigger className="w-[280px]">
              <SelectValue placeholder="Tipo de dispositivo" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {deviceTypeOptions.map((item) => (
                  <SelectItem key={item.value} value={item.label} onClick={() => setSelectedType(item.value)}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </section>
        {/* Total devices and active devices */}
        <section className="flex flex-row gap-4">
          <Card className="w-full">
            <CardHeader>
              <CardDescription>Total de dispositivos</CardDescription>
              <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
                {devices.length}
              </CardTitle>
              <CardAction>
                <div className="flex items-center justify-center bg-secondary rounded-full p-4">
                  <Router className="size-8" />
                </div>
              </CardAction>
            </CardHeader>
            <CardFooter className="flex-col items-start gap-1.5 text-sm">
              <div className="line-clamp-1 flex gap-2 font-medium">
                <PlusCircle className="size-4" /> 7 novo(s) dispositivo(s) encontrado(s)
              </div>
            </CardFooter>
          </Card>
          <Card className="w-full">
            <CardHeader>
              <CardDescription>Online & Ativos</CardDescription>
              <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
                {activeCount.toString().padStart(2, "0")}/{devices.length}
              </CardTitle>
              <CardAction>
                <div className="flex items-center justify-center bg-secondary rounded-full p-4">
                  <Wifi className="size-8" />
                </div>
              </CardAction>
            </CardHeader>
            <CardFooter className="flex-col items-start gap-1.5 text-sm">
              <div className="line-clamp-1 flex gap-2 font-medium bg-secondary rounded-full p-1 w-full">
                <div
                  className="line-clamp-1 flex gap-2 font-medium bg-primary rounded-full p-1"
                  style={{ width: `${(activeCount / devices.length) * 100}%` }}
                >

                </div>
              </div>
            </CardFooter>
          </Card>
          {/* Requerem atenção */}
          <Card className="w-full">
            <CardHeader>
              <CardDescription>Requerem atenção</CardDescription>
              <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
                0
              </CardTitle>
              <CardAction>
                <div className="flex items-center justify-center bg-secondary rounded-full p-4">
                  <WifiOff className="size-8" />
                </div>
              </CardAction>
            </CardHeader>
            <CardFooter className="flex-col items-start gap-1.5 text-sm">
              <div className="line-clamp-1 flex justify-between gap-2 font-medium w-full">
                <span>Tudo está ok</span>
                <span><EllipsisVertical className="size-4" /></span>
              </div>
            </CardFooter>
          </Card>
        </section>

        <Separator className="my-4" />

        {/* Devices list */}
        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3">
          {filteredDevices.map((device) => {
            return (
              <DeviceCard
                key={device.name}
                device={device}
                onActiveChange={(active: boolean) => handleActiveChange(device.name, active)}
              />
            )
          })}
        </section>
      </div>
    </main>
  );
}
