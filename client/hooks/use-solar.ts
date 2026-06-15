import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { getSolarHistory, getSolarLoggers, scanSolarLoggers, SolarHistoryBucket, SolarHistoryRange } from "@/src/services/solar.service"

export function useSolarLoggers(enabled = true) {
  return useQuery({
    queryKey: ["solar-loggers"],
    queryFn: getSolarLoggers,
    enabled,
    refetchInterval: 15_000,
  })
}

export function useScanSolarLoggers() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: scanSolarLoggers,
    onSuccess: (data) => queryClient.setQueryData(["solar-loggers"], data),
  })
}

export function useSolarHistory(options: { range?: SolarHistoryRange; bucket?: SolarHistoryBucket; ip?: string } = {}, enabled = true) {
  return useQuery({
    queryKey: ["solar-history", options.range ?? "7d", options.bucket ?? null, options.ip ?? null],
    queryFn: () => getSolarHistory(options),
    enabled,
    refetchInterval: 60_000,
  })
}
