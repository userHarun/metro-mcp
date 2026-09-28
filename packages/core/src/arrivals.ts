import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { MetroError } from "./errors.js";
import type { MetroLiveClient } from "./metro-client.js";
import type { Arrival, ArrivalsResult } from "./schemas.js";

interface LongLike { toString(): string }
type NumericValue = number | LongLike | null | undefined;

function safeNumber(value: NumericValue): number | null {
  if (value == null) return null;
  const number = typeof value === "number" ? value : Number(value.toString());
  return Number.isSafeInteger(number) ? number : null;
}

function epochToIso(value: NumericValue): string | null {
  const seconds = safeNumber(value);
  if (seconds == null) return null;
  const date = new Date(seconds * 1_000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function getNormalizedArrivals(
  client: MetroLiveClient,
  options: { stopId: string; routeId?: string | undefined; limit: number; nowMs?: number | undefined },
): Promise<ArrivalsResult> {
  const response = await client.getTripUpdatesBytes();
  let feed: GtfsRealtimeBindings.transit_realtime.FeedMessage;
  try {
    feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(response.data);
  } catch (error: unknown) {
    throw new MetroError("invalid_response", "METRO returned malformed GTFS Realtime data.", { cause: error });
  }

  const nowMs = options.nowMs ?? Date.now();
  const cutoffMs = nowMs - 60_000;
  const arrivals: Arrival[] = [];
  for (const entity of feed.entity) {
    const update = entity.tripUpdate;
    if (!update || (options.routeId && update.trip?.routeId !== options.routeId)) continue;
    for (const stopUpdate of update.stopTimeUpdate ?? []) {
      if (stopUpdate.stopId !== options.stopId) continue;
      const arrivalSeconds = safeNumber(stopUpdate.arrival?.time);
      const departureSeconds = safeNumber(stopUpdate.departure?.time);
      const predictedSeconds = arrivalSeconds ?? departureSeconds;
      if (predictedSeconds == null || predictedSeconds * 1_000 < cutoffMs) continue;
      const predictedAt = epochToIso(predictedSeconds);
      if (!predictedAt) continue;
      arrivals.push({
        tripId: update.trip?.tripId || null,
        routeId: update.trip?.routeId || null,
        stopId: options.stopId,
        stopSequence: stopUpdate.stopSequence ?? null,
        predictedAt,
        eventType: arrivalSeconds == null ? "departure" : "arrival",
        delaySeconds: safeNumber(stopUpdate.arrival?.delay ?? stopUpdate.departure?.delay),
        tripUpdatedAt: epochToIso(update.timestamp),
      });
    }
  }

  arrivals.sort((left, right) => left.predictedAt.localeCompare(right.predictedAt));
  const feedTimestamp = epochToIso(feed.header.timestamp);
  const feedTimestampMs = feedTimestamp ? Date.parse(feedTimestamp) : null;
  const ageSeconds = feedTimestampMs == null
    ? null
    : Math.max(0, Math.floor((Date.parse(response.retrievedAt) - feedTimestampMs) / 1_000));

  return {
    stopId: options.stopId,
    arrivals: arrivals.slice(0, options.limit),
    source: {
      provider: "Houston METRO",
      feed: "gtfs-realtime-trip-updates",
      retrievedAt: response.retrievedAt,
      feedTimestamp,
      ageSeconds,
      isStale: ageSeconds == null ? null : ageSeconds > 90,
    },
  };
}
