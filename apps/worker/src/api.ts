import { MetroError, toMetroError, type MetroDataProvider } from "@metro/core";
import { z } from "zod";

const routeSearchSchema = z.object({ query: z.string().trim().min(1).max(80), limit: z.coerce.number().int().min(1).max(20).default(10) });
const stopSearchSchema = z.object({ query: z.string().trim().min(2).max(100), limit: z.coerce.number().int().min(1).max(20).default(10) });
const nearbySchema = z.object({ latitude: z.coerce.number().min(-90).max(90), longitude: z.coerce.number().min(-180).max(180), limit: z.coerce.number().int().min(1).max(10).default(5) });
const arrivalsSchema = z.object({ stopId: z.string().trim().min(1).max(100), routeId: z.string().trim().min(1).max(64).optional(), limit: z.coerce.number().int().min(1).max(10).default(5) });
const alertsSchema = z.object({ routeId: z.string().trim().min(1).max(64).optional() });

const cacheHeaders = {
  catalog: "public, max-age=60, s-maxage=300, stale-while-revalidate=3600",
  alerts: "public, max-age=10, s-maxage=15, stale-while-revalidate=30",
  realtime: "no-store",
} as const;

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("X-Content-Type-Options", "nosniff");
  return Response.json(data, { ...init, headers });
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new MetroError("invalid_request", "The request parameters are invalid.");
  return parsed.data;
}

function query(url: URL): Record<string, string | undefined> {
  return Object.fromEntries(url.searchParams.entries());
}

export async function handleApi(request: Request, env: Env, provider: MetroDataProvider, requestId: string): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== "GET") return json({ error: "method_not_allowed", message: "This endpoint is read-only.", requestId }, { status: 405, headers: { Allow: "GET" } });

  try {
    if (url.pathname === "/api/health") {
      return json({ status: "ok", service: "houston-metro-mcp", environment: env.APP_ENV, requestId }, { headers: { "Cache-Control": "no-store" } });
    }
    if (url.pathname === "/api/config") {
      return json({ githubUrl: env.PUBLIC_GITHUB_URL || null }, { headers: { "Cache-Control": cacheHeaders.catalog } });
    }
    if (url.pathname === "/api/data-sources") {
      return json(await provider.getDataSources(), { headers: { "Cache-Control": cacheHeaders.catalog } });
    }
    if (url.pathname === "/api/routes/search") {
      const input = parse(routeSearchSchema, { query: url.searchParams.get("q"), limit: url.searchParams.get("limit") ?? undefined });
      return json(await provider.searchRoutes(input), { headers: { "Cache-Control": cacheHeaders.catalog } });
    }
    if (url.pathname === "/api/stops/search") {
      const input = parse(stopSearchSchema, { query: url.searchParams.get("q"), limit: url.searchParams.get("limit") ?? undefined });
      return json(await provider.searchStops(input), { headers: { "Cache-Control": cacheHeaders.catalog } });
    }
    if (url.pathname === "/api/stops/nearby") {
      const input = parse(nearbySchema, { latitude: url.searchParams.get("lat"), longitude: url.searchParams.get("lon"), limit: url.searchParams.get("limit") ?? undefined });
      return json(await provider.findNearbyStops(input), { headers: { "Cache-Control": cacheHeaders.catalog } });
    }
    if (url.pathname === "/api/arrivals") {
      const input = parse(arrivalsSchema, { ...query(url), stopId: url.searchParams.get("stopId") });
      return json(await provider.getNextArrivals(input), { headers: { "Cache-Control": cacheHeaders.realtime } });
    }
    if (url.pathname === "/api/alerts") {
      const input = parse(alertsSchema, query(url));
      return json(await provider.getServiceAlerts(input), { headers: { "Cache-Control": cacheHeaders.alerts } });
    }

    const routeMatch = url.pathname.match(/^\/api\/routes\/([^/]+)$/);
    if (routeMatch?.[1]) {
      const route = await provider.getRoute(decodeURIComponent(routeMatch[1]));
      if (!route) throw new MetroError("not_found", "The requested METRO route was not found.");
      return json(route, { headers: { "Cache-Control": cacheHeaders.catalog } });
    }
    const stopMatch = url.pathname.match(/^\/api\/stops\/([^/]+)$/);
    if (stopMatch?.[1]) {
      const stop = await provider.getStop(decodeURIComponent(stopMatch[1]));
      if (!stop) throw new MetroError("not_found", "The requested METRO stop was not found.");
      return json(stop, { headers: { "Cache-Control": cacheHeaders.catalog } });
    }
    return json({ error: "not_found", message: "The requested API route does not exist.", requestId }, { status: 404 });
  } catch (error: unknown) {
    const metroError = toMetroError(error);
    return json({ error: metroError.code, message: metroError.message, requestId }, { status: metroError.status, headers: { "Cache-Control": "no-store" } });
  }
}
