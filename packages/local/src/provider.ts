import {
  createMetroLiveClient,
  getNormalizedAlerts,
  getNormalizedArrivals,
  silentLogger,
  type MetroDataProvider,
  type MetroLogger,
} from "@metro/core";
import { defaultArchivePath, LocalGtfsCatalog } from "./catalog.js";

export interface LocalMetroProviderOptions {
  apiKey: string | undefined;
  cacheDirectory: string;
  baseUrl?: string | undefined;
  staticGtfsUrl?: string | undefined;
  fetcher?: typeof fetch | undefined;
  logger?: MetroLogger | undefined;
}

export function createLocalMetroProvider(options: LocalMetroProviderOptions): MetroDataProvider {
  const logger = options.logger ?? silentLogger;
  const catalog = new LocalGtfsCatalog({
    archivePath: defaultArchivePath(options.cacheDirectory),
    logger,
    ...(options.staticGtfsUrl ? { sourceUrl: options.staticGtfsUrl } : {}),
    ...(options.fetcher ? { fetcher: options.fetcher } : {}),
  });
  const liveClient = createMetroLiveClient({
    baseUrl: options.baseUrl ?? "https://api.ridemetro.org",
    apiKey: options.apiKey,
    requestId: `local-${process.pid}`,
    logger,
    ...(options.fetcher ? { fetcher: options.fetcher } : {}),
  });

  return {
    searchRoutes: (input) => catalog.searchRoutes(input),
    searchStops: (input) => catalog.searchStops(input),
    findNearbyStops: (input) => catalog.findNearbyStops(input),
    getNextArrivals: (input) => getNormalizedArrivals(liveClient, input),
    getServiceAlerts: ({ routeId }) => getNormalizedAlerts(liveClient, routeId),
    getRoute: (routeId) => catalog.getRoute(routeId),
    getStop: (stopId) => catalog.getStop(stopId),
    getDataSources: async () => {
      const catalogInfo = await catalog.getInfo();
      const liveConfigured = Boolean(options.apiKey?.trim());
      return {
        sources: [
          {
            name: "Static GTFS",
            status: "configured",
            detail: `${catalogInfo.routeCount} routes and ${catalogInfo.stopCount} stops loaded ${catalogInfo.loadedFromCache ? "from the local cache" : "from METRO"}.`,
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
