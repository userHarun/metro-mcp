import type {
  AlertsResult,
  ArrivalsResult,
  DataSourcesResult,
  NearbyStopsResult,
  RouteSearchResult,
  StopSearchResult,
  TransitRoute,
  TransitStop,
} from "./schemas.js";

export interface MetroDataProvider {
  searchRoutes(options: { query: string; limit: number }): Promise<RouteSearchResult>;
  searchStops(options: { query: string; limit: number }): Promise<StopSearchResult>;
  findNearbyStops(options: { latitude: number; longitude: number; limit: number }): Promise<NearbyStopsResult>;
  getNextArrivals(options: { stopId: string; routeId?: string | undefined; limit: number }): Promise<ArrivalsResult>;
  getServiceAlerts(options: { routeId?: string | undefined }): Promise<AlertsResult>;
  getRoute(routeId: string): Promise<TransitRoute | null>;
  getStop(stopId: string): Promise<TransitStop | null>;
  getDataSources(): Promise<DataSourcesResult>;
}

export interface MetroLogger {
  log(fields: Record<string, string | number | boolean | null>): void;
  error(fields: Record<string, string | number | boolean | null>): void;
}

export const silentLogger: MetroLogger = {
  log: () => undefined,
  error: () => undefined,
};
