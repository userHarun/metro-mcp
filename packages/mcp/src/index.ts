import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import {
  MetroError,
  alertsResultSchema,
  arrivalsResultSchema,
  dataSourcesResultSchema,
  nearbyStopsResultSchema,
  routeSchema,
  routeSearchResultSchema,
  stopSchema,
  stopSearchResultSchema,
  toMetroError,
  type MetroDataProvider,
} from "@metro/core";
import { z } from "zod";

const serverInfo = { name: "houston-metro", version: "0.1.0" };

function toolFailure(error: unknown) {
  const metroError = toMetroError(error);
  return {
    isError: true,
    content: [{
      type: "text" as const,
      text: JSON.stringify({ error: metroError.code, message: metroError.message, requestId: metroError.requestId }),
    }],
  };
}

function toolSuccess<T extends Record<string, unknown>>(value: T) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

function scalarVariable(value: string | string[] | undefined, name: string): string {
  if (typeof value === "string" && value) return value;
  throw new MetroError("invalid_request", `The ${name} resource identifier is invalid.`);
}

export function createMetroMcpServer(provider: MetroDataProvider): McpServer {
  const server = new McpServer(serverInfo, {
    instructions: "Use Houston METRO route, stop, realtime arrival, and service-alert data. Always preserve source timestamps and distinguish scheduled catalog data from realtime predictions.",
    capabilities: { tools: {}, resources: {} },
    cacheHints: {
      "tools/list": { ttlMs: 300_000, cacheScope: "public" },
      "resources/templates/list": { ttlMs: 300_000, cacheScope: "public" },
    },
  });

  server.registerTool("search_routes", {
    title: "Search METRO routes",
    description: "Find Houston METRO bus or rail routes by number or name. Returns exact provider route IDs for follow-up calls.",
    inputSchema: z.object({
      query: z.string().trim().min(1).max(80).describe("Route number or name, such as 82 or Westheimer"),
      limit: z.number().int().min(1).max(20).default(10),
    }),
    outputSchema: routeSearchResultSchema,
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async (input) => {
    try { return toolSuccess(await provider.searchRoutes(input)); } catch (error: unknown) { return toolFailure(error); }
  });

  server.registerTool("search_stops", {
    title: "Search METRO stops",
    description: "Find Houston METRO stops by public stop code or stop name. Returns exact GTFS stop IDs.",
    inputSchema: z.object({
      query: z.string().trim().min(2).max(100).describe("Stop code or words from the stop name"),
      limit: z.number().int().min(1).max(20).default(10),
    }),
    outputSchema: stopSearchResultSchema,
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async (input) => {
    try { return toolSuccess(await provider.searchStops(input)); } catch (error: unknown) { return toolFailure(error); }
  });

  server.registerTool("find_nearby_stops", {
    title: "Find nearby METRO stops",
    description: "Find physical Houston METRO stops nearest to a latitude and longitude, ordered by distance.",
    inputSchema: z.object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      limit: z.number().int().min(1).max(10).default(5),
    }),
    outputSchema: nearbyStopsResultSchema,
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async (input) => {
    try { return toolSuccess(await provider.findNearbyStops(input)); } catch (error: unknown) { return toolFailure(error); }
  });

  server.registerTool("get_next_arrivals", {
    title: "Get next arrivals",
    description: "Return METRO GTFS Realtime arrival predictions for an exact stop ID, optionally filtered to an exact route ID.",
    inputSchema: z.object({
      stopId: z.string().trim().min(1).max(100),
      routeId: z.string().trim().min(1).max(64).optional(),
      limit: z.number().int().min(1).max(10).default(5),
    }),
    outputSchema: arrivalsResultSchema,
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async (input) => {
    try { return toolSuccess(await provider.getNextArrivals(input)); } catch (error: unknown) { return toolFailure(error); }
  });

  server.registerTool("get_service_alerts", {
    title: "Get service alerts",
    description: "Return active Houston METRO service alerts, optionally filtered to an exact provider route ID.",
    inputSchema: z.object({ routeId: z.string().trim().min(1).max(64).optional() }),
    outputSchema: alertsResultSchema,
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async (input) => {
    try { return toolSuccess(await provider.getServiceAlerts(input)); } catch (error: unknown) { return toolFailure(error); }
  });

  server.registerResource("data-sources", "metro://system/data-sources", {
    title: "Houston METRO data sources",
    description: "Configuration and readiness of the official Static GTFS, GTFS Realtime, and V2 Alerts sources.",
    mimeType: "application/json",
    cacheHint: { ttlMs: 60_000, cacheScope: "public" },
  }, async (uri) => ({
    contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(dataSourcesResultSchema.parse(await provider.getDataSources()), null, 2) }],
  }));

  server.registerResource("route", new ResourceTemplate("metro://routes/{routeId}", { list: undefined }), {
    title: "Houston METRO route",
    description: "A route record from the active Static GTFS catalog.",
    mimeType: "application/json",
    cacheHint: { ttlMs: 300_000, cacheScope: "public" },
  }, async (uri, variables) => {
    const route = await provider.getRoute(scalarVariable(variables.routeId, "route"));
    if (!route) throw new MetroError("not_found", "The requested METRO route was not found.");
    return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(routeSchema.parse(route), null, 2) }] };
  });

  server.registerResource("stop", new ResourceTemplate("metro://stops/{stopId}", { list: undefined }), {
    title: "Houston METRO stop",
    description: "A stop record from the active Static GTFS catalog.",
    mimeType: "application/json",
    cacheHint: { ttlMs: 300_000, cacheScope: "public" },
  }, async (uri, variables) => {
    const stop = await provider.getStop(scalarVariable(variables.stopId, "stop"));
    if (!stop) throw new MetroError("not_found", "The requested METRO stop was not found.");
    return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(stopSchema.parse(stop), null, 2) }] };
  });

  return server;
}
