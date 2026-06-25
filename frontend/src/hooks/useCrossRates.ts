import { useQuery } from "@tanstack/react-query";

import { fetchCrossRates } from "../api/forex";

// Shared cross-rates fetch for currency conversion. Rates move slowly relative to
// a trading session, so we cache generously and let stale data keep working.
export function useCrossRates() {
  return useQuery({
    queryKey: ["forex", "cross-rates"],
    queryFn: fetchCrossRates,
    staleTime: 5 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}
