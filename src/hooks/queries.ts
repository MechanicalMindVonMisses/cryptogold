"use client";

import { keepPreviousData, QueryClient, useQueries, useQuery } from "@tanstack/react-query";
import { RANGES } from "@/lib/ranges";
import type {
  FxResponse,
  HistoryResponse,
  RangeKey,
  SearchResponse,
  SpotResponse,
} from "@/lib/types";

/** Error from our own /api routes, carrying the uniform envelope. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly source: string,
  ) {
    super(`${code} (${source})`);
    this.name = "ApiError";
  }

  get rateLimited(): boolean {
    return this.code === "rate_limited";
  }
}

/** True when the request never reached our server (offline, DNS, connection reset). */
export function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError;
}

export async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string; source?: string } | null;
    throw new ApiError(res.status, body?.error ?? "http_error", body?.source ?? "server");
  }
  return (await res.json()) as T;
}

export const SPOT_REFRESH_MS = 60_000;

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Retry transient failures with 1 s, 2 s, 4 s … capped at 30 s; never retry bad requests.
        retry: (count, error) => {
          if (error instanceof ApiError && error.status < 500) return false;
          return count < 3;
        },
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30_000),
        refetchOnWindowFocus: false,
        gcTime: 30 * 60_000,
      },
    },
  });
}

export const queryKeys = {
  spot: (ids: readonly string[]) => ["spot", [...ids].sort().join(",")] as const,
  history: (id: string, range: RangeKey) => ["history", id, range] as const,
  search: (q: string) => ["search", q] as const,
  fx: (currency: string) => ["fx", currency] as const,
};

/** Live prices for every coin on screen in one request, refreshed every 60 s while the tab is visible. */
export function useSpot(ids: readonly string[], enabled: boolean) {
  const sorted = [...new Set(ids)].sort();
  return useQuery({
    queryKey: queryKeys.spot(sorted),
    queryFn: ({ signal }) =>
      getJson<SpotResponse>(`/api/spot?ids=${sorted.map(encodeURIComponent).join(",")}`, signal),
    enabled: enabled && sorted.length > 0,
    refetchInterval: SPOT_REFRESH_MS,
    refetchIntervalInBackground: false,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

function historyQuery(id: string, range: RangeKey, enabled: boolean) {
  const hourly = RANGES[range].granularity === "hour";
  return {
    queryKey: queryKeys.history(id, range),
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      getJson<HistoryResponse>(`/api/history?id=${encodeURIComponent(id)}&range=${range}`, signal),
    enabled,
    // Recorded history grows every minute; short ranges follow it live, long ranges every 5 minutes.
    staleTime: hourly ? 60_000 : 5 * 60_000,
    refetchInterval: hourly ? 60_000 : 5 * 60_000,
    refetchIntervalInBackground: false,
  };
}

export function useHistory(id: string, range: RangeKey, enabled = true) {
  return useQuery({ ...historyQuery(id, range, enabled), placeholderData: keepPreviousData });
}

/** Several histories in parallel (compare mode). `data` keeps its identity until a result changes. */
export function useHistories(ids: readonly string[], range: RangeKey, enabled: boolean) {
  return useQueries({
    queries: ids.map((id) => historyQuery(id, range, enabled)),
    combine: (results) => ({
      data: results.map((r) => r.data),
      loading: results.some((r) => r.isPending && r.fetchStatus !== "idle"),
      error: results.some((r) => r.isError),
      refetch: () => results.forEach((r) => void r.refetch()),
    }),
  });
}

export function useSearch(query: string) {
  const q = query.trim().toLowerCase();
  return useQuery({
    queryKey: queryKeys.search(q),
    queryFn: ({ signal }) =>
      getJson<SearchResponse>(`/api/search?q=${encodeURIComponent(q)}`, signal),
    enabled: q.length >= 2 && q.length <= 50,
    staleTime: 24 * 60 * 60_000,
    placeholderData: keepPreviousData,
  });
}

export function useFx(currency: "USD" | "TRY") {
  return useQuery({
    queryKey: queryKeys.fx(currency),
    queryFn: ({ signal }) => getJson<FxResponse>(`/api/fx?currency=TRY`, signal),
    enabled: currency === "TRY",
    staleTime: 12 * 60 * 60_000,
  });
}
