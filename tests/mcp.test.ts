import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { createMetroMcpServer } from "@metro/mcp";
import type { MetroDataProvider } from "@metro/core";
import { afterEach, describe, expect, it } from "vitest";

const source = { provider: "Houston METRO" as const, feed: "static-gtfs" as const, retrievedAt: "2026-08-31T12:00:00.000Z", datasetVersion: "fixture" };
const provider: MetroDataProvider = {
  searchRoutes: ({ query }) => Promise.resolve({ query, routes: [{ routeId: "82", shortName: "82", longName: "Westheimer", description: null, routeType: 3, color: "D94136", textColor: "FFFFFF" }], source }),
  searchStops: ({ query }) => Promise.resolve({ query, stops: [{ stopId: "STOP", stopCode: "1001", name: "Westheimer at Main", description: null, latitude: 29.74, longitude: -95.39, locationType: 0, parentStation: null, wheelchairBoarding: 1 }], source }),
  findNearbyStops: ({ latitude, longitude }) => Promise.resolve({ location: { latitude, longitude }, stops: [], source }),
  getNextArrivals: ({ stopId }) => Promise.resolve({ stopId, arrivals: [], coverage: { routeTripUpdates: null, stopTimeUpdates: false }, schedule: null, source: { provider: "Houston METRO", feed: "gtfs-realtime-trip-updates", retrievedAt: "2026-08-31T12:00:00.000Z", feedTimestamp: "2026-08-31T11:59:30.000Z", ageSeconds: 30, isStale: false } }),
  getServiceAlerts: () => Promise.resolve({ alerts: [], source: { provider: "Houston METRO", feed: "v2-alerts-json", retrievedAt: "2026-08-31T12:00:00.000Z" } }),
  getRoute: () => Promise.resolve({ routeId: "82", shortName: "82", longName: "Westheimer", description: null, routeType: 3, color: "D94136", textColor: "FFFFFF" }),
  getStop: () => Promise.resolve({ stopId: "STOP", stopCode: "1001", name: "Westheimer at Main", description: null, latitude: 29.74, longitude: -95.39, locationType: 0, parentStation: null, wheelchairBoarding: 1 }),
  getDataSources: () => Promise.resolve({ sources: [{ name: "Static GTFS", status: "configured", detail: "fixture" }], attribution: "Route and arrival data provided by permission of METRO", trademark: "METRO is a registered trademark." }),
};

const closers: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(closers.splice(0).map((close) => close())); });

describe("MCP contract", () => {
  it("lists five tools and calls a typed tool", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMetroMcpServer(provider);
    await server.connect(serverTransport);
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(clientTransport);
    closers.push(() => client.close(), () => server.close());

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(["search_routes", "search_stops", "find_nearby_stops", "get_next_arrivals", "get_service_alerts"]);
    const result = await client.callTool({ name: "search_routes", arguments: { query: "82", limit: 5 } });
    expect(result.structuredContent).toMatchObject({ query: "82", routes: [{ routeId: "82" }] });
  });

  it("publishes static and templated resources", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMetroMcpServer(provider);
    await server.connect(serverTransport);
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(clientTransport);
    closers.push(() => client.close(), () => server.close());

    const resources = await client.listResources();
    const templates = await client.listResourceTemplates();
    expect(resources.resources.map((resource) => resource.uri)).toContain("metro://system/data-sources");
    expect(templates.resourceTemplates.map((template) => template.uriTemplate)).toEqual(expect.arrayContaining(["metro://routes/{routeId}", "metro://stops/{stopId}"]));
    const route = await client.readResource({ uri: "metro://routes/82" });
    expect(route.contents[0]).toMatchObject({ mimeType: "application/json" });
  });
});
