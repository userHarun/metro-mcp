import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { getNormalizedArrivals, type MetroLiveClient } from "@metro/core";
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
    expect(result.source.ageSeconds).toBe(120);
    expect(result.source.isStale).toBe(true);
  });
});
