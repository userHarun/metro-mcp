import {
  createMetroLiveClient,
  getArrivalsWithRailSchedule,
  getNormalizedAlerts,
  getNormalizedArrivals,
  type MetroDataProvider,
  type MetroLogger,
} from "@metro/core";
import { findNearbyStops, getCatalogReadiness, getNextRailSchedule, getRoute, getStop, searchRoutes, searchStops } from "./catalog.js";

export function createWorkerProvider(env: Env, requestId: string, logger: MetroLogger): MetroDataProvider {
  const liveClient = createMetroLiveClient({
    baseUrl: env.METRO_API_BASE_URL,
    apiKey: env.METRO_GTFS_API_KEY,
    requestId,
    logger,
  });

  return {
    searchRoutes: (options) => searchRoutes(env.GTFS_DB, options),
    searchStops: (options) => searchStops(env.GTFS_DB, options),
    findNearbyStops: (options) => findNearbyStops(env.GTFS_DB, options),
    getNextArrivals: async (options) => {
      const routeId = options.routeId;
      const route = routeId ? await getRoute(env.GTFS_DB, routeId).catch(() => null) : null;
      return route?.routeType === 0 && routeId
        ? getArrivalsWithRailSchedule(liveClient, { ...options, routeId }, () => getNextRailSchedule(env.GTFS_DB, { ...options, routeId }))
        : getNormalizedArrivals(liveClient, options);
    },
    getServiceAlerts: ({ routeId }) => getNormalizedAlerts(liveClient, routeId),
    getRoute: (routeId) => getRoute(env.GTFS_DB, routeId),
    getStop: (stopId) => getStop(env.GTFS_DB, stopId),
    getDataSources: async () => {
      const catalog = await getCatalogReadiness(env.GTFS_DB);
      const liveConfigured = Boolean(env.METRO_GTFS_API_KEY?.trim());
      return {
        sources: [
          {
            name: "Static GTFS",
            status: catalog.ready ? "configured" : "not_ready",
            detail: catalog.ready
              ? `Active catalog ${catalog.source?.datasetVersion ?? "unknown"}.`
              : "Run the GTFS migration and import before using catalog tools.",
          },
          {
            name: "GTFS Realtime",
            status: liveConfigured ? "configured" : "missing",
            detail: liveConfigured ? "Trip Updates subscription is configured." : "METRO_GTFS_API_KEY is missing.",
          },
          {
            name: "V2 Alerts",
            status: liveConfigured ? "configured" : "missing",
            detail: liveConfigured ? "V2 Alerts subscription is configured." : "METRO_GTFS_API_KEY is missing.",
          },
        ],
        attribution: "Route and arrival data provided by permission of METRO",
        trademark: "METRO is the registered trademark of the Metropolitan Transit Authority of Harris County, Texas.",
      };
    },
  };
}
