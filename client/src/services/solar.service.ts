export type SolarLogger = {
  ip: string
  mac?: string | null
  serial?: string | null
  loggerSerial?: string | null
  firmware?: string | null
  currentPowerW?: number | null
  todayEnergyKwh?: number | null
  totalEnergyKwh?: number | null
  signalPercent?: number | null
  alarm?: string | null
  serverConnected?: boolean | null
  online: boolean
  error?: string | null
  fetchedAt: string
}

export type SolarLoggersResponse = {
  loggers: SolarLogger[]
  summary: {
    discovered: number
    online: number
    currentPowerW: number
    todayEnergyKwh: number
    totalEnergyKwh: number
  }
  fetchedAt: string
}

export type SolarHistoryRange = "24h" | "7d" | "30d" | "90d"

export type SolarHistoryBucket = "hour" | "day"

export type SolarHistoryPoint = {
  bucketStart: string
  samples: number
  avgPowerW: number
  maxPowerW: number
  generatedEnergyKwh: number
  totalEnergyKwh: number
}

export type SolarHistoryResponse = {
  range: SolarHistoryRange
  bucket: SolarHistoryBucket
  points: SolarHistoryPoint[]
  summary: {
    samples: number
    generatedEnergyKwh: number
    maxPowerW: number
  }
  fetchedAt: string
}

export async function getSolarLoggers(): Promise<SolarLoggersResponse> {
  return solarRequest("GET")
}

export async function scanSolarLoggers(): Promise<SolarLoggersResponse> {
  return solarRequest("POST")
}

export async function getSolarHistory(options: { range?: SolarHistoryRange; bucket?: SolarHistoryBucket; ip?: string } = {}): Promise<SolarHistoryResponse> {
  const params = new URLSearchParams()
  if (options.range) params.set("range", options.range)
  if (options.bucket) params.set("bucket", options.bucket)
  if (options.ip) params.set("ip", options.ip)
  const query = params.toString()
  const response = await fetch(`/api/solar/history${query ? `?${query}` : ""}`, { cache: "no-store" })

  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { message?: string }
    throw new Error(data.message || "Falha ao consultar historico solar.")
  }

  return response.json()
}

async function solarRequest(method: "GET" | "POST"): Promise<SolarLoggersResponse> {
  const response = await fetch("/api/solar", { method, cache: "no-store" })

  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { message?: string }
    throw new Error(data.message || "Falha ao consultar loggers solares.")
  }

  return response.json()
}
