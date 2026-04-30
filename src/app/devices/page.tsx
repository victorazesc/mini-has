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

const devices = [
  {
    name: "Churrasqueira",
    provider: "Tuya",
    type: "LAMP",
    status: "online",
    active: true,
    room: "Cozinha",
  },
  {
    name: "Interruptor Escritório 1",
    provider: "Tuya",
    type: "LAMP",
    status: "online",
    active: true,
    room: "Escritório",
  },
  {
    name: "Interruptor Escritório 2",
    provider: "Tuya",
    type: "LAMP",
    status: "online",
    active: true,
    room: "Escritório",
  },
  {
    name: "Câmera da Frente",
    provider: "INTELBRAS",
    type: "CAM",
    status: "online",
    active: true,
    room: "Área externa",
  },
  {
    name: "Câmera dos Fundos",
    provider: "INTELBRAS",
    type: "CAM",
    status: "online",
    active: true,
    room: "Área externa",
  },
  {
    name: "Alimentador de Gatos",
    provider: "TUYA",
    type: "FEEDER",
    status: "online",
    active: true,
    room: "Cozinha",
  },
  {
    name: "Persiana",
    provider: "DIY",
    type: "CURTAIN",
    status: "online",
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
            const DeviceIcon = DEVICE_ICON_BY_TYPE[device.type as keyof typeof DEVICE_ICON_BY_TYPE] ?? Lightbulb
            const ProviderIcon = PROVIDERS_ICON_BY_TYPE[device.provider as keyof typeof PROVIDERS_ICON_BY_TYPE] ?? "./providers/diy.svg"
            const ProviderName = PROVIDERS_NAME_BY_TYPE[device.provider as keyof typeof PROVIDERS_NAME_BY_TYPE] ?? "DIY"

            return (
              <Card className="col-span-1" key={device.name}>
                <CardHeader className="flex flex-row items-center gap-4">
                  <div className="flex items-center justify-center rounded-full bg-secondary p-4">
                    <DeviceIcon className="size-5" />
                  </div>
                  <div className="flex min-w-0 flex-col gap-1">
                    <CardTitle>{device.name}</CardTitle>
                    <CardDescription>{device.room}</CardDescription>
                  </div>
                  <CardAction className="ml-auto self-start">
                    <EllipsisVertical className="size-4" />
                  </CardAction>
                </CardHeader>
                <CardFooter className="flex-row justify-between items-center gap-1.5 text-sm">
                  <div className="flex flex-col gap-2 font-medium pt-4">
                    <h3 className="uppercase text-xs text-muted-foreground">Provider</h3>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center justify-center rounded-sm bg-secondary p-1">
                        <Image src={ProviderIcon} alt={ProviderName} width={24} height={24} />
                      </div>
                      <span>{ProviderName}</span>
                    </div>
                  </div>
                  <div className="flex flex-row gap-2">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={activeDevices[device.name]}
                      aria-label={`Alternar ${device.name}`}
                      className="group relative h-7 w-17 rounded-full border-2 border-primary bg-primary transition-colors aria-[checked=false]:border-transparent aria-[checked=false]:bg-input/90"
                      onClick={() =>
                        setActiveDevices((current) => ({
                          ...current,
                          [device.name]: !current[device.name],
                        }))
                      }
                    >
                      <span className="block h-6 w-9 translate-x-[calc(100%-8px)] rounded-full bg-primary-foreground shadow-sm transition-transform group-aria-[checked=false]:translate-x-0" />
                    </button>
                  </div>
                </CardFooter>
              </Card>
            )
          })}
        </section>
      </div>
    </main>
  );
}
