"use client"

import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { useScanSolarLoggers, useSolarHistory, useSolarLoggers } from "@/hooks/use-solar"
import { SolarHistoryRange, SolarLogger } from "@/src/services/solar.service"
import { ActivityIcon, Loader2Icon, RadioTowerIcon, RefreshCwIcon, SearchIcon, SunIcon, ZapIcon } from "lucide-react"
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"

const historyRanges: { value: SolarHistoryRange; label: string }[] = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7 dias" },
  { value: "30d", label: "30 dias" },
]

const historyChartConfig = {
  generatedEnergyKwh: {
    label: "Energia",
    color: "var(--primary)",
  },
  avgPowerW: {
    label: "Potência média",
    color: "var(--chart-2)",
  },
} satisfies ChartConfig

export default function SolarPage() {
  const [historyRange, setHistoryRange] = useState<SolarHistoryRange>("7d")
  const { data, isLoading, isError, error, refetch, isFetching } = useSolarLoggers()
  const { data: history, isLoading: isLoadingHistory } = useSolarHistory({ range: historyRange })
  const scan = useScanSolarLoggers()
  const summary = data?.summary

  return (
    <main className="flex flex-1 flex-col gap-4 px-3 sm:px-4 lg:px-6">
      <section className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Energia solar local</h1>
          <p className="text-sm text-muted-foreground">Dados lidos diretamente dos loggers encontrados na sua rede.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" disabled={isFetching} onClick={() => void refetch()}>
            <RefreshCwIcon className={isFetching ? "animate-spin" : ""} />
            Atualizar
          </Button>
          <Button disabled={scan.isPending} onClick={() => scan.mutate()}>
            {scan.isPending ? <Loader2Icon className="animate-spin" /> : <SearchIcon />}
            Buscar loggers
          </Button>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Potência agora" value={formatPower(summary?.currentPowerW)} icon={<ZapIcon />} />
        <MetricCard label="Energia hoje" value={formatEnergy(summary?.todayEnergyKwh)} icon={<SunIcon />} />
        <MetricCard label="Energia total" value={formatEnergy(summary?.totalEnergyKwh)} icon={<ActivityIcon />} />
        <MetricCard label="Loggers online" value={`${summary?.online ?? 0}/${summary?.discovered ?? 0}`} icon={<RadioTowerIcon />} />
      </section>

      <SolarHistoryCard
        range={historyRange}
        onRangeChange={setHistoryRange}
        points={history?.points ?? []}
        generatedEnergyKwh={history?.summary.generatedEnergyKwh ?? 0}
        maxPowerW={history?.summary.maxPowerW ?? 0}
        isLoading={isLoadingHistory}
      />

      {isLoading ? (
        <Card><CardContent className="flex items-center gap-2"><Loader2Icon className="animate-spin" /> Consultando loggers locais...</CardContent></Card>
      ) : null}

      {isError ? (
        <Card>
          <CardHeader>
            <CardTitle>Falha ao consultar loggers</CardTitle>
            <CardDescription>{error.message}</CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {scan.isError ? (
        <Card><CardContent className="text-destructive">{scan.error.message}</CardContent></Card>
      ) : null}

      {!isLoading && !data?.loggers.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Nenhum logger identificado</CardTitle>
            <CardDescription>Use “Buscar loggers” para procurar dispositivos compatíveis na rede local.</CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {data?.loggers.map((logger) => <LoggerCard key={logger.ip} logger={logger} />)}
      </section>
    </main>
  )
}

function SolarHistoryCard({
  range,
  onRangeChange,
  points,
  generatedEnergyKwh,
  maxPowerW,
  isLoading,
}: {
  range: SolarHistoryRange
  onRangeChange: (range: SolarHistoryRange) => void
  points: { bucketStart: string; generatedEnergyKwh: number; avgPowerW: number; maxPowerW: number }[]
  generatedEnergyKwh: number
  maxPowerW: number
  isLoading: boolean
}) {
  const chartData = points.map((point) => ({
    ...point,
    label: formatBucket(point.bucketStart, range),
  }))

  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>Histórico de geração</CardTitle>
          <CardDescription>
            {formatEnergy(generatedEnergyKwh)} gerados no período • pico de {formatPower(maxPowerW)}
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          {historyRanges.map((item) => (
            <Button
              key={item.value}
              size="sm"
              variant={range === item.value ? "default" : "outline"}
              onClick={() => onRangeChange(item.value)}
            >
              {item.label}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex h-60 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2Icon className="animate-spin" /> Carregando histórico...
          </div>
        ) : chartData.length ? (
          <ChartContainer config={historyChartConfig} className="h-60 w-full">
            <AreaChart data={chartData} margin={{ left: 0, right: 12, top: 12 }}>
              <defs>
                <linearGradient id="fillSolarEnergy" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-generatedEnergyKwh)" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="var(--color-generatedEnergyKwh)" stopOpacity={0.1} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
              <YAxis tickLine={false} axisLine={false} tickMargin={8} width={44} tickFormatter={(value) => `${value} kWh`} />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    labelFormatter={(_, payload) => formatDateTime(payload?.[0]?.payload?.bucketStart)}
                    formatter={(value, name) => [name === "avgPowerW" ? formatPower(Number(value)) : formatEnergy(Number(value)), name === "avgPowerW" ? "Potência média" : "Energia"]}
                  />
                }
              />
              <Area
                dataKey="generatedEnergyKwh"
                type="natural"
                fill="url(#fillSolarEnergy)"
                stroke="var(--color-generatedEnergyKwh)"
                strokeWidth={2}
              />
            </AreaChart>
          </ChartContainer>
        ) : (
          <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
            O histórico começa a aparecer depois das próximas leituras do logger.
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function MetricCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <Card size="sm">
      <CardHeader className="grid grid-cols-[1fr_auto] items-center">
        <div>
          <CardDescription>{label}</CardDescription>
          <CardTitle className="mt-1 text-xl tabular-nums sm:text-2xl">{value}</CardTitle>
        </div>
        <div className="rounded-full bg-secondary p-3 [&_svg]:size-5">{icon}</div>
      </CardHeader>
    </Card>
  )
}

function LoggerCard({ logger }: { logger: SolarLogger }) {
  return (
    <Card>
      <CardHeader className="grid grid-cols-[1fr_auto]">
        <div>
          <CardTitle>Logger {logger.serial || logger.loggerSerial || logger.ip}</CardTitle>
          <CardDescription>{logger.ip}{logger.mac ? ` • ${logger.mac}` : ""}</CardDescription>
        </div>
        <Badge variant={logger.online ? "secondary" : "destructive"}>{logger.online ? "Online" : "Offline"}</Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        {logger.online ? (
          <>
            <div className="grid grid-cols-3 gap-2">
              <LoggerMetric label="Agora" value={formatPower(logger.currentPowerW)} />
              <LoggerMetric label="Hoje" value={formatEnergy(logger.todayEnergyKwh)} />
              <LoggerMetric label="Total" value={formatEnergy(logger.totalEnergyKwh)} />
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
              <span>Sinal Wi-Fi: {logger.signalPercent ?? "—"}%</span>
              <span>Servidor remoto: {logger.serverConnected ? "conectado" : "desconectado"}</span>
              <span>Logger: {logger.loggerSerial || "—"}</span>
              <span>Firmware: {logger.firmware || "—"}</span>
            </div>
            {logger.alarm ? <p className="text-sm text-destructive">{logger.alarm}</p> : null}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{logger.error || "Logger indisponível."}</p>
        )}
      </CardContent>
    </Card>
  )
}

function LoggerMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-secondary/60 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium tabular-nums">{value}</p>
    </div>
  )
}

function formatPower(value?: number | null) {
  return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(value || 0)} W`
}

function formatEnergy(value?: number | null) {
  return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value || 0)} kWh`
}

function formatBucket(value: string, range: SolarHistoryRange) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat("pt-BR", range === "24h" ? { hour: "2-digit" } : { day: "2-digit", month: "2-digit" }).format(date)
}

function formatDateTime(value?: string) {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date)
}
