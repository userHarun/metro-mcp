import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { getArrivalsWithRailSchedule, getNormalizedArrivals, type MetroLiveClient } from "@metro/core";
import { describe, expect, it } from "vitest";

describe("arrival normalization", () => {
  it("filters, orders, limits, and marks stale realtime predictions", async () => {
    const nowSeconds = 1_800_000_000;
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.create({
      header: { gtfsRealtimeVersion: "2.0", timestamp: nowSeconds - 120 },
      entity: [
        { id: "later", tripUpdate: { trip: { tripId: "t2", routeId: "82" }, stopTimeUpdate: [{ stopId: "STOP", arrival: { time: nowSeconds + 600 } }] } },
        { id: "soon", tripUpdate: { trip: { tripId: "t1", routeId: "82" }, stopTimeUpdate: [{ stopId: "STOP", arrival: { time: nowSeconds + 180 } }] } },
        { id: "other", tripUpdate: { trip: { tripId: "t3", routeId: "25" }, stopTimeUpdate: [{ stopId: "STOP", arrival: { time: nowSeconds + 60 } }] } },
      ],
    });
    const bytes = GtfsRealtimeBindings.transit_realtime.FeedMessage.encode(feed).finish();
    const client: MetroLiveClient = {
      getAlertsJson: () => Promise.reject(new Error("unused")),
      getAlertRoutesJson: () => Promise.reject(new Error("unused")),
      getTripUpdatesBytes: () => Promise.resolve({ data: bytes, retrievedAt: new Date(nowSeconds * 1_000).toISOString(), contentType: "application/x-protobuf", durationMs: 1 }),
    };
    const result = await getNormalizedArrivals(client, { stopId: "STOP", routeId: "82", limit: 2, nowMs: nowSeconds * 1_000 });
    expect(result.arrivals.map((arrival) => arrival.tripId)).toEqual(["t1", "t2"]);
    expect(result.coverage).toEqual({ routeTripUpdates: true, stopTimeUpdates: true });
    expect(result.source.ageSeconds).toBe(120);
    expect(result.source.isStale).toBe(true);
  });

  it("reports when the current feed has no updates for a rail route", async () => {
    const nowSeconds = 1_800_000_000;
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.create({
      header: { gtfsRealtimeVersion: "2.0", timestamp: nowSeconds },
      entity: [{ id: "bus", tripUpdate: { trip: { tripId: "bus-1", routeId: "082" }, stopTimeUpdate: [{ stopId: "25051", arrival: { time: nowSeconds + 120 } }] } }],
    });
    const client: MetroLiveClient = {
      getAlertsJson: () => Promise.reject(new Error("unused")),
      getAlertRoutesJson: () => Promise.reject(new Error("unused")),
      getTripUpdatesBytes: () => Promise.resolve({ data: GtfsRealtimeBindings.transit_realtime.FeedMessage.encode(feed).finish(), retrievedAt: new Date(nowSeconds * 1_000).toISOString(), contentType: "application/x-protobuf", durationMs: 1 }),
    };
    const result = await getNormalizedArrivals(client, { stopId: "25051", routeId: "900", limit: 5, nowMs: nowSeconds * 1_000 });
    expect(result.arrivals).toEqual([]);
    expect(result.coverage).toEqual({ routeTripUpdates: false, stopTimeUpdates: false });
  });

  it("returns a separately sourced rail schedule when the live feed is unavailable", async () => {
    const client: MetroLiveClient = {
      getAlertsJson: () => Promise.reject(new Error("unused")),
      getAlertRoutesJson: () => Promise.reject(new Error("unused")),
      getTripUpdatesBytes: () => Promise.reject(new Error("upstream unavailable")),
    };
    const result = await getArrivalsWithRailSchedule(client, { stopId: "25051", routeId: "900", limit: 5 }, async () => ({
      arrivals: [{ tripId: "rail-1", routeId: "900", stopId: "25051", scheduledAt: "2026-09-28T19:12:00.000Z", headsign: "Palm Center" }],
      source: { provider: "Houston METRO", feed: "static-gtfs", retrievedAt: "2026-09-28T19:00:00.000Z", feedTimestamp: null, ageSeconds: null, isStale: null, datasetVersion: "fixture-v1", serviceStartDate: null, serviceEndDate: null },
    }));
    expect(result.arrivals).toEqual([]);
    expect(result.schedule?.arrivals).toHaveLength(1);
    expect(result.source.feed).toBe("static-gtfs");
    expect(result.coverage).toEqual({ routeTripUpdates: null, stopTimeUpdates: null });
  });
});
