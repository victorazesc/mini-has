"use client"
import * as React from "react"
import { Badge } from "@/components/ui/badge"
import { Card, CardAction, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Separator } from "@/components/ui/separator"
import { DEVICE_TYPES } from "@/src/constants/devices_types"
import { PlusCircle, Router, SearchIcon, EllipsisVertical, Wifi, WifiOff, Loader2Icon } from "lucide-react"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DeviceCard, DeviceCardSkeleton } from "@/components/device-card"
import { useDevices, useSendCommand } from "@/hooks/use-devices"
import { useState } from "react"
import { useDebounce } from "@/hooks/use-debounce"
import { Button } from "@/components/ui/button"
import { ScanDevicesDialog } from "@/components/scan-devices-dialog"
import { NewIntegrationDialog } from "@/components/new-integration-dialog"
import { useInboxDevices } from "@/hooks/use-inbox-devices"
import { Device } from "@/src/services/devices.service"

const deviceTypeOptions = [
  { label: "Todos os dispositivos", value: "all" },
  ...DEVICE_TYPES,
]

export default function Devices() {
  const [search, setSearch] = useState("");
  const [selectedType, setSelectedType] = React.useState("all")


  const debouncedSearch = useDebounce(search, 500)

  const { data: devices = [], isLoading, isError, error, refetch } = useDevices(
    { name: debouncedSearch, type: selectedType }
  )

  const { data: inboxDevices = [], isPending: isLoadingInboxDevices } = useInboxDevices({ status: "pending" })

  // const { mutate: sendActiveCommand } = useSendCommand(deviceId, "set_active")

  return (
    <main className="flex flex-1 flex-col px-4 lg:px-6">
      <div className="@container/main flex flex-1 flex-col gap-2 space-y-4">

        {/* Status and IP */}
        <section className="flex flex-row gap-2 justify-between items-center">
          <div>
            <Badge variant="outline">LAN Ativa</Badge>
            <Badge variant="outline">Atualizando em 30/04, 14:53</Badge>
            <Badge variant="outline">IP 192.168.1.136</Badge>
          </div>
          <NewIntegrationDialog>
            <Button variant="outline"><PlusCircle className="size-4" /> Nova Integração</Button>
          </NewIntegrationDialog>
        </section>
        {/* Search and Filter */}
        <section className="flex flex-row gap-4 justify-between">
          <InputGroup>
            <InputGroupInput
              placeholder="Buscar dispositivos..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
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
          <ScanDevicesDialog provider={"tuya_cloud"} integrationId={0}>
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
                  <PlusCircle className="size-4" /> {isLoadingInboxDevices ? <Loader2Icon className="size-4 animate-spin" /> : inboxDevices.length} novo(s) dispositivo(s) encontrado(s)
                </div>
              </CardFooter>
            </Card>
          </ScanDevicesDialog>

          {/* Online & Ativos */}
          <Card className="w-full">
            <CardHeader>
              <CardDescription>Online & Ativos</CardDescription>
              <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
                {devices.filter((device) => device.status.online).length}/{devices.length}
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
                  style={{ width: `${(devices.filter((device) => device.status.online).length / devices.length) * 100}%` }}
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

        {isLoading && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3">
            {Array.from({ length: 9 }).map((_, index) => (
              <DeviceCardSkeleton key={index} />
            ))}
          </div>
        )}

        {isError && (
          <Card>
            <CardHeader>
              <CardTitle>Erro ao carregar dispositivos.</CardTitle>
              <CardDescription>{error.message}</CardDescription>
            </CardHeader>
            <CardFooter>
              <Button onClick={() => refetch()}>Tentar novamente</Button>
            </CardFooter>
          </Card>
        )}

        {/* Devices list */}
        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3">
          {devices.map((device) => {
            return (
              <DeviceCard
                key={device.name}
                device={device}
                onActiveChange={() => {}}
              />
            )
          })}
        </section>
      </div>
    </main>
  );
}
