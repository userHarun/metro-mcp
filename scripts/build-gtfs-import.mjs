import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import { parse as parseStream } from "csv-parse";
import { parse } from "csv-parse/sync";
import { unzipSync } from "fflate";

const DEFAULT_URL = "https://metro.resourcespace.com/pages/download.php?ref=4835&ext=zip";
const MAX_ZIP_BYTES = 32 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 96 * 1024 * 1024;
const IMPORT_SCHEMA_VERSION = "routes-stops-rail-v2";

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function sql(value) {
  if (value == null || value === "") return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function required(record, key, file) {
  const value = record[key]?.trim();
  if (!value) throw new Error(`${file} contains a row without ${key}.`);
  return value;
}

function optional(record, key) {
  const value = record[key]?.trim();
  return value ? value : null;
}

function integer(record, key, file, requiredValue = false) {
  const value = optional(record, key);
  if (value == null && !requiredValue) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`${file} contains an invalid ${key}.`);
  return parsed;
}

function coordinate(record, key, min, max) {
  const value = Number(required(record, key, "stops.txt"));
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`stops.txt contains an invalid ${key}.`);
  return value;
}

function csv(bytes, file) {
  return parse(new TextDecoder().decode(bytes), {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    relax_column_count: false,
    trim: false,
    info: false,
    on_record(record) {
      if (!record || typeof record !== "object") throw new Error(`${file} contains an invalid row.`);
      return record;
    },
  });
}

function gtfsSeconds(value) {
  const match = value?.trim().match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  return hours <= 48 && minutes < 60 && seconds < 60 ? hours * 3600 + minutes * 60 + seconds : null;
}

async function loadArchive(input) {
  if (/^https?:\/\//i.test(input)) {
    const response = await fetch(input, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`GTFS download failed with HTTP ${response.status}.`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_ZIP_BYTES) throw new Error("GTFS ZIP exceeds the configured size limit.");
    return bytes;
  }
  const bytes = new Uint8Array(await readFile(resolve(input)));
  if (bytes.byteLength > MAX_ZIP_BYTES) throw new Error("GTFS ZIP exceeds the configured size limit.");
  return bytes;
}

const input = argument("--input", DEFAULT_URL);
const output = resolve(argument("--output", "tmp/gtfs/static-gtfs-import.sql"));
const zipBytes = await loadArchive(input);
const archive = unzipSync(zipBytes, {
  filter(file) {
    const name = basename(file.name).toLowerCase();
    return ["routes.txt", "stops.txt", "feed_info.txt", "trips.txt", "stop_times.txt", "calendar.txt", "calendar_dates.txt"].includes(name);
  },
});
const files = new Map(Object.entries(archive).map(([name, bytes]) => [basename(name).toLowerCase(), bytes]));
for (const requiredFile of ["routes.txt", "stops.txt", "trips.txt", "stop_times.txt", "calendar.txt"]) {
  if (!files.has(requiredFile)) throw new Error(`GTFS archive is missing ${requiredFile}.`);
}
const extractedBytes = [...files.values()].reduce((total, bytes) => total + bytes.byteLength, 0);
if (extractedBytes > MAX_EXTRACTED_BYTES) throw new Error("Selected GTFS files exceed the configured extracted size limit.");

const routes = csv(files.get("routes.txt"), "routes.txt");
const stops = csv(files.get("stops.txt"), "stops.txt");
const trips = csv(files.get("trips.txt"), "trips.txt");
const calendars = csv(files.get("calendar.txt"), "calendar.txt");
const exceptions = files.has("calendar_dates.txt") ? csv(files.get("calendar_dates.txt"), "calendar_dates.txt") : [];
const feedInfo = files.has("feed_info.txt") ? csv(files.get("feed_info.txt"), "feed_info.txt")[0] ?? {} : {};
const routeIds = new Set();
const stopIds = new Set();

const routeRows = routes.map((record) => {
  const routeId = required(record, "route_id", "routes.txt");
  if (routeIds.has(routeId)) throw new Error(`routes.txt contains duplicate route_id ${routeId}.`);
  routeIds.add(routeId);
  return {
    routeId,
    agencyId: optional(record, "agency_id"),
    shortName: optional(record, "route_short_name"),
    longName: optional(record, "route_long_name"),
    description: optional(record, "route_desc"),
    routeType: integer(record, "route_type", "routes.txt", true),
    url: optional(record, "route_url"),
    color: optional(record, "route_color"),
    textColor: optional(record, "route_text_color"),
  };
});

const stopRows = stops.map((record) => {
  const stopId = required(record, "stop_id", "stops.txt");
  if (stopIds.has(stopId)) throw new Error(`stops.txt contains duplicate stop_id ${stopId}.`);
  stopIds.add(stopId);
  return {
    stopId,
    code: optional(record, "stop_code"),
    name: required(record, "stop_name", "stops.txt"),
    description: optional(record, "stop_desc"),
    latitude: coordinate(record, "stop_lat", -90, 90),
    longitude: coordinate(record, "stop_lon", -180, 180),
    zoneId: optional(record, "zone_id"),
    url: optional(record, "stop_url"),
    locationType: integer(record, "location_type", "stops.txt"),
    parentStation: optional(record, "parent_station"),
    timezone: optional(record, "stop_timezone"),
    wheelchairBoarding: integer(record, "wheelchair_boarding", "stops.txt"),
  };
});

const railRouteIds = new Set(routeRows.filter((route) => route.routeType === 0).map((route) => route.routeId));
const railTrips = new Map(trips.filter((record) => railRouteIds.has(record.route_id?.trim())).map((record) => [required(record, "trip_id", "trips.txt"), {
  routeId: required(record, "route_id", "trips.txt"),
  serviceId: required(record, "service_id", "trips.txt"),
  headsign: optional(record, "trip_headsign"),
}]));
const railStopTimes = [];
const stopTimesBytes = files.get("stop_times.txt");
const chunks = function* () {
  for (let index = 0; index < stopTimesBytes.length; index += 64 * 1024) yield stopTimesBytes.subarray(index, index + 64 * 1024);
};
for await (const record of Readable.from(chunks()).pipe(parseStream({ bom: true, columns: true, trim: true }))) {
  const tripId = record.trip_id?.trim();
  const trip = railTrips.get(tripId);
  if (!trip || record.pickup_type?.trim() === "1") continue;
  const stopId = required(record, "stop_id", "stop_times.txt");
  if (!stopIds.has(stopId)) throw new Error(`stop_times.txt references unknown stop ${stopId}.`);
  const departureSeconds = gtfsSeconds(record.departure_time ?? record.arrival_time);
  if (departureSeconds == null) continue;
  railStopTimes.push({ ...trip, tripId, stopId, stopSequence: integer(record, "stop_sequence", "stop_times.txt", true), departureSeconds, headsign: optional(record, "stop_headsign") ?? trip.headsign });
}

const digest = createHash("sha256").update(zipBytes).digest("hex");
const datasetId = `metro-${digest.slice(0, 16)}`;
const importedAt = new Date().toISOString();
const statements = [
  "PRAGMA foreign_keys = ON;",
  `INSERT OR REPLACE INTO gtfs_datasets (dataset_id, source_sha256, import_schema_version, feed_version, feed_start_date, feed_end_date, imported_at, route_count, stop_count) VALUES (${sql(datasetId)}, ${sql(digest)}, ${sql(IMPORT_SCHEMA_VERSION)}, ${sql(optional(feedInfo, "feed_version"))}, ${sql(optional(feedInfo, "feed_start_date"))}, ${sql(optional(feedInfo, "feed_end_date"))}, ${sql(importedAt)}, ${routeRows.length}, ${stopRows.length});`,
  `DELETE FROM gtfs_routes WHERE dataset_id = ${sql(datasetId)};`,
  `DELETE FROM gtfs_stops WHERE dataset_id = ${sql(datasetId)};`,
  `DELETE FROM gtfs_rail_stop_times WHERE dataset_id = ${sql(datasetId)};`,
  `DELETE FROM gtfs_service_calendar WHERE dataset_id = ${sql(datasetId)};`,
  `DELETE FROM gtfs_service_exceptions WHERE dataset_id = ${sql(datasetId)};`,
];

for (const route of routeRows) {
  statements.push(`INSERT INTO gtfs_routes (dataset_id, route_id, agency_id, route_short_name, route_long_name, route_desc, route_type, route_url, route_color, route_text_color) VALUES (${sql(datasetId)}, ${sql(route.routeId)}, ${sql(route.agencyId)}, ${sql(route.shortName)}, ${sql(route.longName)}, ${sql(route.description)}, ${route.routeType}, ${sql(route.url)}, ${sql(route.color)}, ${sql(route.textColor)});`);
}
for (const stop of stopRows) {
  statements.push(`INSERT INTO gtfs_stops (dataset_id, stop_id, stop_code, stop_name, stop_desc, stop_lat, stop_lon, zone_id, stop_url, location_type, parent_station, stop_timezone, wheelchair_boarding) VALUES (${sql(datasetId)}, ${sql(stop.stopId)}, ${sql(stop.code)}, ${sql(stop.name)}, ${sql(stop.description)}, ${stop.latitude}, ${stop.longitude}, ${sql(stop.zoneId)}, ${sql(stop.url)}, ${stop.locationType ?? "NULL"}, ${sql(stop.parentStation)}, ${sql(stop.timezone)}, ${stop.wheelchairBoarding ?? "NULL"});`);
}
for (const record of calendars) {
  statements.push(`INSERT INTO gtfs_service_calendar (dataset_id, service_id, start_date, end_date, sunday, monday, tuesday, wednesday, thursday, friday, saturday) VALUES (${sql(datasetId)}, ${sql(required(record, "service_id", "calendar.txt"))}, ${sql(required(record, "start_date", "calendar.txt"))}, ${sql(required(record, "end_date", "calendar.txt"))}, ${["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].map((day) => integer(record, day, "calendar.txt", true)).join(", ")});`);
}
for (const record of exceptions) {
  statements.push(`INSERT INTO gtfs_service_exceptions (dataset_id, service_id, service_date, exception_type) VALUES (${sql(datasetId)}, ${sql(required(record, "service_id", "calendar_dates.txt"))}, ${sql(required(record, "date", "calendar_dates.txt"))}, ${integer(record, "exception_type", "calendar_dates.txt", true)});`);
}
for (let index = 0; index < railStopTimes.length; index += 100) {
  const values = railStopTimes.slice(index, index + 100).map((row) => `(${sql(datasetId)}, ${sql(row.routeId)}, ${sql(row.serviceId)}, ${sql(row.tripId)}, ${sql(row.stopId)}, ${row.stopSequence}, ${row.departureSeconds}, ${sql(row.headsign)})`).join(",");
  statements.push(`INSERT INTO gtfs_rail_stop_times (dataset_id, route_id, service_id, trip_id, stop_id, stop_sequence, departure_seconds, headsign) VALUES ${values};`);
}
statements.push(`UPDATE gtfs_state SET active_dataset_id = ${sql(datasetId)} WHERE singleton_id = 1;`);

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${statements.join("\n")}\n`, "utf8");
console.log(JSON.stringify({ output, datasetId, routeCount: routeRows.length, stopCount: stopRows.length, railStopTimeCount: railStopTimes.length, sourceSha256: digest }, null, 2));
