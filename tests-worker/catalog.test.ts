import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { getNextRailSchedule } from "../apps/worker/src/catalog";

const dataset = "fixture";

beforeEach(async () => {
  await env.GTFS_DB.exec("UPDATE gtfs_state SET active_dataset_id = NULL WHERE singleton_id = 1; DELETE FROM gtfs_routes; DELETE FROM gtfs_stops; DELETE FROM gtfs_datasets;");
  await env.GTFS_DB.batch([
    env.GTFS_DB.prepare("INSERT INTO gtfs_datasets (dataset_id, source_sha256, import_schema_version, feed_version, feed_start_date, feed_end_date, imported_at, route_count, stop_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(dataset, "fixture-sha", "routes-stops-rail-v2", "fixture-v1", "2026-08-01", "2026-12-31", "2026-08-31T12:00:00.000Z", 3, 3),
    env.GTFS_DB.prepare("INSERT INTO gtfs_routes (dataset_id, route_id, route_short_name, route_long_name, route_type) VALUES (?, 'route-82', '082', 'Westheimer', 3), (?, 'route-25', '25', 'Richmond', 3), (?, '900', '900', 'METRORAIL PURPLE LINE', 0)").bind(dataset, dataset, dataset),
    env.GTFS_DB.prepare("INSERT INTO gtfs_stops (dataset_id, stop_id, stop_code, stop_name, stop_lat, stop_lon, location_type) VALUES (?, 'stop-1', '1001', 'Westheimer at Main', 29.74, -95.39, 0), (?, 'stop-2', '1002', 'Richmond at Main', 29.73, -95.39, 0), (?, '25051', '25051', 'Theater District Rusk EB', 29.76, -95.36, 0)").bind(dataset, dataset, dataset),
    env.GTFS_DB.prepare("INSERT INTO gtfs_service_calendar (dataset_id, service_id, start_date, end_date, sunday, monday, tuesday, wednesday, thursday, friday, saturday) VALUES (?, 'weekday', '20260830', '20270123', 0, 1, 1, 1, 1, 1, 0)").bind(dataset),
    env.GTFS_DB.prepare("INSERT INTO gtfs_rail_stop_times (dataset_id, route_id, service_id, trip_id, stop_id, stop_sequence, departure_seconds, headsign) VALUES (?, '900', 'weekday', 'rail-1', '25051', 1, 51120, 'Palm Center')").bind(dataset),
    env.GTFS_DB.prepare("UPDATE gtfs_state SET active_dataset_id = ? WHERE singleton_id = 1").bind(dataset),
  ]);
});

describe("Worker catalog API", () => {
  it("finds exact route numbers and stop names", async () => {
    const [routes, stops] = await Promise.all([
      SELF.fetch("https://example.com/api/routes/search?q=82"),
      SELF.fetch("https://example.com/api/stops/search?q=westheimer%20at%20main"),
    ]);
    expect(routes.status).toBe(200);
    expect(stops.status).toBe(200);
    expect((await routes.json<{ routes: Array<{ routeId: string }> }>()).routes[0]?.routeId).toBe("route-82");
    expect((await stops.json<{ stops: Array<{ stopId: string }> }>()).stops[0]?.stopId).toBe("stop-1");
  });

  it("rejects invalid query inputs before accessing providers", async () => {
    const response = await SELF.fetch("https://example.com/api/stops/nearby?lat=Houston&lon=-95.4&limit=20");
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_request" });
  });

  it("serves a health response without leaking secrets", async () => {
    const response = await SELF.fetch("https://example.com/api/health");
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).not.toContain("test-only-key");
  });

  it("returns scheduled Purple Line times from D1", async () => {
    const schedule = await getNextRailSchedule(env.GTFS_DB, { stopId: "25051", routeId: "900", limit: 5, nowMs: Date.parse("2026-09-28T19:00:00.000Z") });
    expect(schedule.arrivals[0]).toMatchObject({ routeId: "900", scheduledAt: "2026-09-28T19:12:00.000Z" });
  });

  it("finds rail platforms by line and filters station searches to that line", async () => {
    const byLine = await SELF.fetch("https://example.com/api/stops/search?q=Purple%20Line");
    const filtered = await SELF.fetch("https://example.com/api/stops/search?q=Theater&railRouteId=900");
    const unrelated = await SELF.fetch("https://example.com/api/stops/search?q=Westheimer&railRouteId=900");
    expect(byLine.status).toBe(200);
    expect((await byLine.json<{ stops: Array<{ stopId: string }> }>()).stops.map((stop) => stop.stopId)).toContain("25051");
    expect((await filtered.json<{ stops: Array<{ stopId: string }> }>()).stops.map((stop) => stop.stopId)).toEqual(["25051"]);
    expect((await unrelated.json<{ stops: Array<{ stopId: string }> }>()).stops).toEqual([]);
  });
});
