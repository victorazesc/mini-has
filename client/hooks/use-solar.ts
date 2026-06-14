import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { getSolarLoggers, scanSolarLoggers } from "@/src/services/solar.service"

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
