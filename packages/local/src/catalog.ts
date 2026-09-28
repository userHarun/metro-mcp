import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { Readable } from "node:stream";
import { parse as parseStream } from "csv-parse";
import { parse } from "csv-parse/sync";
import { unzipSync } from "fflate";
import {
  MetroError,
  nextScheduledRailArrivals,
  type MetroLogger,
  type NearbyStopsResult,
  type RouteSearchResult,
  type RailScheduleResult,
  type RailStopTime,
  type ServiceCalendar,
  type ServiceException,
  type SourceMetadata,
  type StopSearchResult,
  type TransitRoute,
  type TransitStop,
} from "@metro/core";

const DEFAULT_STATIC_GTFS_URL = "https://metro.resourcespace.com/pages/download.php?ref=4835&ext=zip";
const DEFAULT_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const MAX_ZIP_BYTES = 32 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 96 * 1024 * 1024;

type CsvRecord = Record<string, string | undefined>;

interface CatalogState {
  routes: TransitRoute[];
  stops: TransitStop[];
  routesById: Map<string, TransitRoute>;
  stopsById: Map<string, TransitStop>;
  datasetVersion: string;
  serviceStartDate: string | null;
  serviceEndDate: string | null;
  loadedFromCache: boolean;
}

interface RailScheduleState {
  stopTimesByStop: Map<string, RailStopTime[]>;
  calendars: ServiceCalendar[];
  exceptions: ServiceException[];
}

export interface LocalCatalogOptions {
  archivePath: string;
  sourceUrl?: string | undefined;
  refreshIntervalMs?: number | undefined;
  fetcher?: typeof fetch | undefined;
  logger: MetroLogger;
  now?: (() => number) | undefined;
}

function optional(record: CsvRecord, key: string): string | null {
  const value = record[key]?.trim();
  return value ? value : null;
}

function required(record: CsvRecord, key: string, file: string): string {
  const value = optional(record, key);
  if (!value) throw new MetroError("invalid_response", `${file} contains a row without ${key}.`);
  return value;
}

function integer(record: CsvRecord, key: string, file: string, requiredValue = false): number | null {
  const value = optional(record, key);
  if (value == null && !requiredValue) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new MetroError("invalid_response", `${file} contains an invalid ${key}.`);
  return parsed;
}

function coordinate(record: CsvRecord, key: string, min: number, max: number): number {
  const parsed = Number(required(record, key, "stops.txt"));
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new MetroError("invalid_response", `stops.txt contains an invalid ${key}.`);
  }
  return parsed;
}

function parseCsv(bytes: Uint8Array, file: string): CsvRecord[] {
  let result: unknown;
  try {
    result = parse(new TextDecoder().decode(bytes), {
      bom: true,
      columns: true,
      skip_empty_lines: true,
      relax_column_count: false,
      trim: false,
    });
  } catch (error: unknown) {
    throw new MetroError("invalid_response", `${file} could not be parsed.`, { cause: error });
  }
  if (!Array.isArray(result)) throw new MetroError("invalid_response", `${file} is not a valid GTFS table.`);
  return result.map((record) => {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new MetroError("invalid_response", `${file} contains an invalid row.`);
    }
    return record as CsvRecord;
  });
}

function radians(value: number): number { return value * Math.PI / 180; }

function distanceMeters(from: { latitude: number; longitude: number }, to: { latitude: number; longitude: number }): number {
  const radius = 6_371_000;
  const latitudeDelta = radians(to.latitude - from.latitude);
  const longitudeDelta = radians(to.longitude - from.longitude);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return Math.round(radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function normalize(value: string): string {
  return value.toLocaleLowerCase("en-US").replace(/\s+/g, " ").trim();
}

function gtfsSeconds(value: string | undefined): number | null {
  const match = value?.trim().match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  return hours <= 48 && minutes < 60 && seconds < 60 ? hours * 3600 + minutes * 60 + seconds : null;
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel("Static GTFS exceeded the configured size limit.");
        throw new MetroError("invalid_response", "The METRO Static GTFS archive is larger than allowed.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function routeRank(route: TransitRoute, query: string): number | null {
  const routeId = normalize(route.routeId);
  const shortName = normalize(route.shortName ?? "");
  const longName = normalize(route.longName ?? "");
  const description = normalize(route.description ?? "");
  const normalizedNumber = query.replace(/^0+(?=\d)/, "");
  if (routeId === query || shortName === query || (/^\d+$/.test(query) && shortName.replace(/^0+(?=\d)/, "") === normalizedNumber)) return 0;
  if (shortName.startsWith(query)) return 1;
  if (longName.startsWith(query)) return 2;
  if ([routeId, shortName, longName, description].some((value) => value.includes(query))) return 3;
  return null;
}

function stopRank(stop: TransitStop, query: string, tokens: string[]): number | null {
  const stopId = normalize(stop.stopId);
  const stopCode = normalize(stop.stopCode ?? "");
  const name = normalize(stop.name);
  const description = normalize(stop.description ?? "");
  if (stopId === query || stopCode === query) return 0;
  if (name === query) return 1;
  if (name.startsWith(query)) return 2;
  const searchable = `${name} ${description} ${stopCode}`;
  if (tokens.every((token) => searchable.includes(token))) return 3;
  if (searchable.includes(query)) return 4;
  return null;
}

export class LocalGtfsCatalog {
  readonly #options: LocalCatalogOptions;
  #state: CatalogState | null = null;
  #loading: Promise<CatalogState> | null = null;
  #railSchedule: Promise<RailScheduleState> | null = null;

  constructor(options: LocalCatalogOptions) {
    this.#options = options;
  }

  async #download(): Promise<Uint8Array> {
    const fetcher = this.#options.fetcher ?? fetch;
    let response: Response;
    try {
      response = await fetcher(this.#options.sourceUrl ?? DEFAULT_STATIC_GTFS_URL, {
        headers: { Accept: "application/zip, application/octet-stream" },
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error: unknown) {
      throw new MetroError("upstream", "The METRO Static GTFS archive could not be downloaded.", { cause: error });
    }
    if (!response.ok) throw new MetroError("upstream", "The METRO Static GTFS archive could not be downloaded.");
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_ZIP_BYTES) {
      throw new MetroError("invalid_response", "The METRO Static GTFS archive is larger than allowed.");
    }
    const bytes = await readBoundedBody(response, MAX_ZIP_BYTES);
    if (!bytes.byteLength || bytes.byteLength > MAX_ZIP_BYTES) {
      throw new MetroError("invalid_response", "The METRO Static GTFS archive has an invalid size.");
    }
    return bytes;
  }

  async #loadBytes(): Promise<{ bytes: Uint8Array; loadedFromCache: boolean }> {
    const now = this.#options.now?.() ?? Date.now();
    const maxAge = this.#options.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS;
    let cached: Uint8Array | null = null;
    let cacheIsFresh = false;
    try {
      const [bytes, details] = await Promise.all([readFile(this.#options.archivePath), stat(this.#options.archivePath)]);
      cached = new Uint8Array(bytes);
      cacheIsFresh = cached.byteLength > 0 && cached.byteLength <= MAX_ZIP_BYTES && now - details.mtimeMs <= maxAge;
    } catch {
      cached = null;
    }
    if (cached && cacheIsFresh) return { bytes: cached, loadedFromCache: true };

    try {
      const bytes = await this.#download();
      await mkdir(dirname(this.#options.archivePath), { recursive: true });
      await writeFile(this.#options.archivePath, bytes);
      return { bytes, loadedFromCache: false };
    } catch (error: unknown) {
      if (cached) {
        this.#options.logger.error({ event: "static_gtfs_refresh_failed", fallback: "stale_cache" });
        return { bytes: cached, loadedFromCache: true };
      }
      throw error;
    }
  }

  async #initialize(): Promise<CatalogState> {
    const { bytes, loadedFromCache } = await this.#loadBytes();
    let extracted: Record<string, Uint8Array>;
    try {
      extracted = unzipSync(bytes, {
        filter(file) {
          const name = basename(file.name).toLowerCase();
          return name === "routes.txt" || name === "stops.txt" || name === "feed_info.txt";
        },
      });
    } catch (error: unknown) {
      throw new MetroError("invalid_response", "The METRO Static GTFS archive could not be opened.", { cause: error });
    }
    const files = new Map(Object.entries(extracted).map(([name, value]) => [basename(name).toLowerCase(), value]));
    const routesFile = files.get("routes.txt");
    const stopsFile = files.get("stops.txt");
    if (!routesFile || !stopsFile) throw new MetroError("invalid_response", "The METRO Static GTFS archive is incomplete.");
    const extractedBytes = [...files.values()].reduce((total, value) => total + value.byteLength, 0);
    if (extractedBytes > MAX_EXTRACTED_BYTES) throw new MetroError("invalid_response", "The METRO Static GTFS archive is larger than allowed.");

    const routeIds = new Set<string>();
    const routes = parseCsv(routesFile, "routes.txt").map((record): TransitRoute => {
      const routeId = required(record, "route_id", "routes.txt");
      if (routeIds.has(routeId)) throw new MetroError("invalid_response", "routes.txt contains duplicate route identifiers.");
      routeIds.add(routeId);
      return {
        routeId,
        shortName: optional(record, "route_short_name"),
        longName: optional(record, "route_long_name"),
        description: optional(record, "route_desc"),
        routeType: integer(record, "route_type", "routes.txt", true) as number,
        color: optional(record, "route_color"),
        textColor: optional(record, "route_text_color"),
      };
    });

    const stopIds = new Set<string>();
    const stops = parseCsv(stopsFile, "stops.txt").map((record): TransitStop => {
      const stopId = required(record, "stop_id", "stops.txt");
      if (stopIds.has(stopId)) throw new MetroError("invalid_response", "stops.txt contains duplicate stop identifiers.");
      stopIds.add(stopId);
      return {
        stopId,
        stopCode: optional(record, "stop_code"),
        name: required(record, "stop_name", "stops.txt"),
        description: optional(record, "stop_desc"),
        latitude: coordinate(record, "stop_lat", -90, 90),
        longitude: coordinate(record, "stop_lon", -180, 180),
        locationType: integer(record, "location_type", "stops.txt"),
        parentStation: optional(record, "parent_station"),
        wheelchairBoarding: integer(record, "wheelchair_boarding", "stops.txt"),
      };
    });

    const feedInfoFile = files.get("feed_info.txt");
    const feedInfo = feedInfoFile ? parseCsv(feedInfoFile, "feed_info.txt")[0] : undefined;
    const digest = createHash("sha256").update(bytes).digest("hex");
    const state: CatalogState = {
      routes,
      stops,
      routesById: new Map(routes.map((route) => [route.routeId, route])),
      stopsById: new Map(stops.map((stop) => [stop.stopId, stop])),
      datasetVersion: (feedInfo && optional(feedInfo, "feed_version")) ?? `metro-${digest.slice(0, 16)}`,
      serviceStartDate: feedInfo ? optional(feedInfo, "feed_start_date") : null,
      serviceEndDate: feedInfo ? optional(feedInfo, "feed_end_date") : null,
      loadedFromCache,
    };
    this.#options.logger.log({ event: "static_gtfs_ready", routes: routes.length, stops: stops.length, cached: loadedFromCache });
    return state;
  }

  async #requireState(): Promise<CatalogState> {
    if (this.#state) return this.#state;
    this.#loading ??= this.#initialize();
    try {
      this.#state = await this.#loading;
      return this.#state;
    } catch (error: unknown) {
      this.#loading = null;
      if (error instanceof MetroError) throw error;
      throw new MetroError("catalog_not_ready", "The local Static GTFS catalog is not ready.", { cause: error });
    }
  }

  #source(state: CatalogState): SourceMetadata {
    return {
      provider: "Houston METRO",
      feed: "static-gtfs",
      retrievedAt: new Date(this.#options.now?.() ?? Date.now()).toISOString(),
      datasetVersion: state.datasetVersion,
      serviceStartDate: state.serviceStartDate,
      serviceEndDate: state.serviceEndDate,
    };
  }

  async #loadRailSchedule(state: CatalogState): Promise<RailScheduleState> {
    const bytes = new Uint8Array(await readFile(this.#options.archivePath));
    const extracted = unzipSync(bytes, {
      filter(file) {
        const name = basename(file.name).toLowerCase();
        return ["trips.txt", "stop_times.txt", "calendar.txt", "calendar_dates.txt"].includes(name);
      },
    });
    const files = new Map(Object.entries(extracted).map(([name, value]) => [basename(name).toLowerCase(), value]));
    const tripsFile = files.get("trips.txt");
    const stopTimesFile = files.get("stop_times.txt");
    const calendarFile = files.get("calendar.txt");
    if (!tripsFile || !stopTimesFile || !calendarFile) throw new MetroError("invalid_response", "The METRO rail schedule files are incomplete.");
    if ([...files.values()].reduce((total, value) => total + value.byteLength, 0) > MAX_EXTRACTED_BYTES) {
      throw new MetroError("invalid_response", "The METRO rail schedule is larger than allowed.");
    }
    const railRoutes = new Set(state.routes.filter((route) => route.routeType === 0).map((route) => route.routeId));
    const trips = new Map(parseCsv(tripsFile, "trips.txt")
      .filter((record) => railRoutes.has(record.route_id ?? ""))
      .map((record) => [required(record, "trip_id", "trips.txt"), {
        routeId: required(record, "route_id", "trips.txt"),
        serviceId: required(record, "service_id", "trips.txt"),
        headsign: optional(record, "trip_headsign"),
      }]));
    const calendars: ServiceCalendar[] = parseCsv(calendarFile, "calendar.txt").map((record) => ({
      serviceId: required(record, "service_id", "calendar.txt"),
      startDate: required(record, "start_date", "calendar.txt"),
      endDate: required(record, "end_date", "calendar.txt"),
      weekdays: ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].map((day) => record[day]?.trim() === "1"),
    }));
    const exceptions: ServiceException[] = files.has("calendar_dates.txt")
      ? parseCsv(files.get("calendar_dates.txt")!, "calendar_dates.txt").map((record) => ({
        serviceId: required(record, "service_id", "calendar_dates.txt"),
        date: required(record, "date", "calendar_dates.txt"),
        type: integer(record, "exception_type", "calendar_dates.txt", true) as 1 | 2,
      })) : [];
    const byStop = new Map<string, RailStopTime[]>();
    const chunks = function* () {
      for (let index = 0; index < stopTimesFile.length; index += 64 * 1024) yield stopTimesFile.subarray(index, index + 64 * 1024);
    };
    try {
      for await (const record of Readable.from(chunks()).pipe(parseStream({ bom: true, columns: true, trim: true })) as AsyncIterable<CsvRecord>) {
        const tripId = record.trip_id?.trim() ?? "";
        const trip = trips.get(tripId);
        if (!trip || record.pickup_type?.trim() === "1") continue;
        const stopId = required(record, "stop_id", "stop_times.txt");
        const departureSeconds = gtfsSeconds(record.departure_time ?? record.arrival_time);
        if (departureSeconds == null) continue;
        const row: RailStopTime = { ...trip, tripId, stopId, departureSeconds, headsign: optional(record, "stop_headsign") ?? trip.headsign };
        const rows = byStop.get(stopId) ?? [];
        rows.push(row);
        byStop.set(stopId, rows);
      }
    } catch (error: unknown) {
      throw new MetroError("invalid_response", "The METRO rail schedule could not be parsed.", { cause: error });
    }
    return { stopTimesByStop: byStop, calendars, exceptions };
  }

  async #requireRailSchedule(state: CatalogState): Promise<RailScheduleState> {
    this.#railSchedule ??= this.#loadRailSchedule(state);
    try { return await this.#railSchedule; }
    catch (error: unknown) { this.#railSchedule = null; throw error; }
  }

  async getNextRailSchedule(options: { stopId: string; routeId: string; limit: number; nowMs?: number }): Promise<RailScheduleResult> {
    const state = await this.#requireState();
    const schedule = await this.#requireRailSchedule(state);
    const stopTimes = (schedule.stopTimesByStop.get(options.stopId) ?? []).filter((row) => row.routeId === options.routeId);
    return {
      arrivals: nextScheduledRailArrivals(stopTimes, schedule.calendars, schedule.exceptions, options.nowMs ?? Date.now(), options.limit),
      source: this.#source(state),
    };
  }

  async searchRoutes(options: { query: string; limit: number }): Promise<RouteSearchResult> {
    const state = await this.#requireState();
    const query = options.query.trim();
    const normalizedQuery = normalize(query);
    const routes = state.routes
      .map((route) => ({ route, rank: routeRank(route, normalizedQuery) }))
      .filter((item): item is { route: TransitRoute; rank: number } => item.rank != null)
      .sort((left, right) => left.rank - right.rank
        || (left.route.shortName ?? "").localeCompare(right.route.shortName ?? "", undefined, { numeric: true })
        || (left.route.longName ?? "").localeCompare(right.route.longName ?? ""))
      .slice(0, options.limit)
      .map(({ route }) => route);
    return { query, routes, source: this.#source(state) };
  }

  async searchStops(options: { query: string; limit: number; railRouteId?: string | undefined }): Promise<StopSearchResult> {
    const state = await this.#requireState();
    const query = options.query.trim();
    const normalizedQuery = normalize(query);
    const tokens = normalizedQuery.match(/[\p{L}\p{N}]+/gu) ?? [normalizedQuery];
    const schedule = options.railRouteId ? await this.#requireRailSchedule(state) : null;
    const belongsToRoute = (stopId: string, routeId: string) => (schedule?.stopTimesByStop.get(stopId) ?? []).some((row) => row.routeId === routeId);
    let stops = state.stops
      .filter((stop) => !options.railRouteId || belongsToRoute(stop.stopId, options.railRouteId))
      .map((stop) => ({ stop, rank: stopRank(stop, normalizedQuery, tokens) }))
      .filter((item): item is { stop: TransitStop; rank: number } => item.rank != null)
      .sort((left, right) => left.rank - right.rank || left.stop.name.localeCompare(right.stop.name) || left.stop.stopId.localeCompare(right.stop.stopId))
      .slice(0, options.limit)
      .map(({ stop }) => stop);
    if (!stops.length) {
      const railRoute = options.railRouteId
        ? state.routesById.get(options.railRouteId)
        : state.routes.filter((route) => route.routeType === 0 && routeRank(route, normalizedQuery) != null)
          .sort((left, right) => (routeRank(left, normalizedQuery) ?? 9) - (routeRank(right, normalizedQuery) ?? 9))[0];
      if (railRoute?.routeType === 0 && routeRank(railRoute, normalizedQuery) != null) {
        const railSchedule = schedule ?? await this.#requireRailSchedule(state);
        stops = state.stops.filter((stop) => (railSchedule.stopTimesByStop.get(stop.stopId) ?? []).some((row) => row.routeId === railRoute.routeId))
          .sort((left, right) => left.name.localeCompare(right.name) || left.stopId.localeCompare(right.stopId)).slice(0, options.limit);
      }
    }
    return { query, stops, source: this.#source(state) };
  }

  async findNearbyStops(options: { latitude: number; longitude: number; limit: number }): Promise<NearbyStopsResult> {
    const state = await this.#requireState();
    const location = { latitude: options.latitude, longitude: options.longitude };
    const stops = state.stops
      .filter((stop) => (stop.locationType ?? 0) === 0)
      .map((stop) => ({ ...stop, distanceMeters: distanceMeters(location, stop) }))
      .sort((left, right) => left.distanceMeters - right.distanceMeters || left.name.localeCompare(right.name))
      .slice(0, options.limit);
    return { location, stops, source: this.#source(state) };
  }

  async getRoute(routeId: string): Promise<TransitRoute | null> {
    return (await this.#requireState()).routesById.get(routeId) ?? null;
  }

  async getStop(stopId: string): Promise<TransitStop | null> {
    return (await this.#requireState()).stopsById.get(stopId) ?? null;
  }

  async getInfo(): Promise<{ source: SourceMetadata; routeCount: number; stopCount: number; loadedFromCache: boolean }> {
    const state = await this.#requireState();
    return { source: this.#source(state), routeCount: state.routes.length, stopCount: state.stops.length, loadedFromCache: state.loadedFromCache };
  }
}

export function defaultArchivePath(cacheDirectory: string): string {
  return join(cacheDirectory, "static-gtfs.zip");
}
