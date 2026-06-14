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

export async function getSolarLoggers(): Promise<SolarLoggersResponse> {
  return solarRequest("GET")
}

export async function scanSolarLoggers(): Promise<SolarLoggersResponse> {
  return solarRequest("POST")
}

async function solarRequest(method: "GET" | "POST"): Promise<SolarLoggersResponse> {
  const response = await fetch("/api/solar", { method, cache: "no-store" })

  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { message?: string }
    throw new Error(data.message || "Falha ao consultar loggers solares.")
  }

  return response.json()
}
