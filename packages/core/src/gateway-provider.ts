import { MetroError } from "./errors.js";
import type { MetroDataProvider } from "./provider.js";
import {
  alertsResultSchema,
  arrivalsResultSchema,
  dataSourcesResultSchema,
  nearbyStopsResultSchema,
  routeSchema,
  routeSearchResultSchema,
  stopSchema,
  stopSearchResultSchema,
} from "./schemas.js";
import type { z } from "zod";

interface GatewayOptions {
  baseUrl: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}

export function createGatewayProvider(options: GatewayOptions): MetroDataProvider {
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;

  async function get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    const url = new URL(path, options.baseUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetcher(url, { headers: { Accept: "application/json" }, signal: controller.signal });
    } catch (error: unknown) {
      throw new MetroError(controller.signal.aborted ? "timeout" : "upstream", "The hosted METRO service is unavailable.", { cause: error });
    } finally {
      clearTimeout(timeout);
    }
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const errorPayload = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
      const code = typeof errorPayload.error === "string" ? errorPayload.error : "upstream";
      const message = typeof errorPayload.message === "string" ? errorPayload.message : "The hosted METRO service rejected the request.";
      throw new MetroError(code === "catalog_not_ready" ? "catalog_not_ready" : "upstream", message, { status: response.status });
    }
    const parsed = schema.safeParse(payload);
    if (!parsed.success) throw new MetroError("invalid_response", "The hosted METRO service returned an invalid response.");
    return parsed.data;
  }

  return {
    searchRoutes: ({ query, limit }) => get(`/api/routes/search?q=${encodeURIComponent(query)}&limit=${limit}`, routeSearchResultSchema),
    searchStops: ({ query, limit }) => get(`/api/stops/search?q=${encodeURIComponent(query)}&limit=${limit}`, stopSearchResultSchema),
    findNearbyStops: ({ latitude, longitude, limit }) => get(`/api/stops/nearby?lat=${latitude}&lon=${longitude}&limit=${limit}`, nearbyStopsResultSchema),
    getNextArrivals: ({ stopId, routeId, limit }) => {
      const params = new URLSearchParams({ stopId, limit: String(limit) });
      if (routeId) params.set("routeId", routeId);
      return get(`/api/arrivals?${params}`, arrivalsResultSchema);
    },
    getServiceAlerts: ({ routeId }) => {
      const params = new URLSearchParams();
      if (routeId) params.set("routeId", routeId);
      return get(`/api/alerts?${params}`, alertsResultSchema);
    },
    getRoute: (routeId) => get(`/api/routes/${encodeURIComponent(routeId)}`, routeSchema.nullable()),
    getStop: (stopId) => get(`/api/stops/${encodeURIComponent(stopId)}`, stopSchema.nullable()),
    getDataSources: () => get("/api/data-sources", dataSourcesResultSchema),
  };
}
