import { MetroError, type NearbyStopsResult, type RouteSearchResult, type SourceMetadata, type StopSearchResult, type TransitRoute, type TransitStop } from "@metro/core";

interface DatasetRow {
  dataset_id: string;
  import_schema_version: string;
  feed_version: string | null;
  feed_start_date: string | null;
  feed_end_date: string | null;
  imported_at: string;
}

interface RouteRow {
  route_id: string;
  route_short_name: string | null;
  route_long_name: string | null;
  route_desc: string | null;
  route_type: number;
  route_color: string | null;
  route_text_color: string | null;
}

interface StopRow {
  stop_id: string;
  stop_code: string | null;
  stop_name: string;
  stop_desc: string | null;
  stop_lat: number;
  stop_lon: number;
  location_type: number | null;
  parent_station: string | null;
  wheelchair_boarding: number | null;
}

const activeDatasetSql = `
  SELECT d.dataset_id, d.import_schema_version, d.feed_version, d.feed_start_date,
         d.feed_end_date, d.imported_at
  FROM gtfs_state s
  JOIN gtfs_datasets d ON d.dataset_id = s.active_dataset_id
  WHERE s.singleton_id = 1
`;

function toSource(row: DatasetRow): SourceMetadata {
  return {
    provider: "Houston METRO",
    feed: "static-gtfs",
    retrievedAt: new Date().toISOString(),
    datasetVersion: row.feed_version ?? row.dataset_id,
    serviceStartDate: row.feed_start_date,
    serviceEndDate: row.feed_end_date,
  };
}

async function requireDataset(db: D1Database): Promise<{ row: DatasetRow; source: SourceMetadata }> {
  try {
    const row = await db.prepare(activeDatasetSql).first<DatasetRow>();
    if (!row) throw new MetroError("catalog_not_ready", "No Static GTFS dataset has been activated.");
    return { row, source: toSource(row) };
  } catch (error: unknown) {
    if (error instanceof MetroError) throw error;
    throw new MetroError("catalog_not_ready", "The Static GTFS catalog is not ready.", { cause: error });
  }
}

function routeFromRow(row: RouteRow): TransitRoute {
  return {
    routeId: row.route_id,
    shortName: row.route_short_name,
    longName: row.route_long_name,
    description: row.route_desc,
    routeType: row.route_type,
    color: row.route_color,
    textColor: row.route_text_color,
  };
}

function stopFromRow(row: StopRow): TransitStop {
  return {
    stopId: row.stop_id,
    stopCode: row.stop_code,
    name: row.stop_name,
    description: row.stop_desc,
    latitude: row.stop_lat,
    longitude: row.stop_lon,
    locationType: row.location_type,
    parentStation: row.parent_station,
    wheelchairBoarding: row.wheelchair_boarding,
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function ftsPrefixQuery(value: string): string | null {
  const ignored = new Set(["a", "an", "and", "at", "of", "on", "the"]);
  const tokens = value.toLocaleLowerCase("en-US").match(/[\p{L}\p{N}]+/gu)?.filter((token) => !ignored.has(token)).slice(0, 8);
  return tokens?.length ? tokens.map((token) => `"${token}"*`).join(" AND ") : null;
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

export async function searchRoutes(db: D1Database, options: { query: string; limit: number }): Promise<RouteSearchResult> {
  const { row, source } = await requireDataset(db);
  const query = options.query.trim();
  const escaped = escapeLike(query);
  const numeric = /^\d+$/.test(query);
  const normalizedNumber = query.replace(/^0+(?=\d)/, "");
  try {
    const result = await db.prepare(`
      SELECT route_id, route_short_name, route_long_name, route_desc, route_type, route_color, route_text_color
      FROM gtfs_routes
      WHERE dataset_id = ? AND (
        route_short_name LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR (? = 1 AND ltrim(route_short_name, '0') = ?)
        OR route_long_name LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR route_desc LIKE ? ESCAPE '\\' COLLATE NOCASE
      )
      ORDER BY CASE
        WHEN route_short_name = ? COLLATE NOCASE OR (? = 1 AND ltrim(route_short_name, '0') = ?) THEN 0
        WHEN route_short_name LIKE ? ESCAPE '\\' COLLATE NOCASE THEN 1
        WHEN route_long_name LIKE ? ESCAPE '\\' COLLATE NOCASE THEN 2 ELSE 3 END,
        route_short_name COLLATE NOCASE, route_long_name COLLATE NOCASE, route_id
      LIMIT ?
    `).bind(row.dataset_id, `${escaped}%`, numeric ? 1 : 0, normalizedNumber, `%${escaped}%`, `%${escaped}%`, query, numeric ? 1 : 0, normalizedNumber, `${escaped}%`, `${escaped}%`, options.limit).all<RouteRow>();
    return { query, routes: result.results.map(routeFromRow), source };
  } catch (error: unknown) {
    throw new MetroError("internal_error", "The route catalog query failed.", { cause: error });
  }
}

export async function searchStops(db: D1Database, options: { query: string; limit: number }): Promise<StopSearchResult> {
  const { row, source } = await requireDataset(db);
  const query = options.query.trim();
  const ftsQuery = ftsPrefixQuery(query);
  try {
    const exact = await db.prepare(`
      SELECT stop_id, stop_code, stop_name, stop_desc, stop_lat, stop_lon, location_type, parent_station, wheelchair_boarding
      FROM gtfs_stops WHERE dataset_id = ? AND stop_code = ? COLLATE NOCASE
      ORDER BY stop_name COLLATE NOCASE LIMIT ?
    `).bind(row.dataset_id, query, options.limit).all<StopRow>();
    const matched = ftsQuery ? await db.prepare(`
      SELECT s.stop_id, s.stop_code, s.stop_name, s.stop_desc, s.stop_lat, s.stop_lon, s.location_type, s.parent_station, s.wheelchair_boarding
      FROM gtfs_stop_search f JOIN gtfs_stops s ON s.rowid = f.rowid
      WHERE s.dataset_id = ? AND gtfs_stop_search MATCH ?
      ORDER BY bm25(gtfs_stop_search, 0.0, 0.0, 1.0, 2.0, 0.25), s.stop_name COLLATE NOCASE LIMIT ?
    `).bind(row.dataset_id, ftsQuery, options.limit * 2).all<StopRow>() : { results: [] as StopRow[] };
    const unique = Array.from(new Map([...exact.results, ...matched.results].map((stop) => [stop.stop_id, stop])).values()).slice(0, options.limit);
    return { query, stops: unique.map(stopFromRow), source };
  } catch (error: unknown) {
    throw new MetroError("internal_error", "The stop catalog query failed.", { cause: error });
  }
}

export async function findNearbyStops(db: D1Database, options: { latitude: number; longitude: number; limit: number }): Promise<NearbyStopsResult> {
  const { row, source } = await requireDataset(db);
  let candidates: StopRow[] = [];
  try {
    for (const radiusKm of [2, 8, 32, 80]) {
      const latitudeDelta = radiusKm / 111.32;
      const longitudeDelta = radiusKm / (111.32 * Math.max(Math.cos(radians(options.latitude)), 0.1));
      const result = await db.prepare(`
        SELECT stop_id, stop_code, stop_name, stop_desc, stop_lat, stop_lon, location_type, parent_station, wheelchair_boarding
        FROM gtfs_stops
        WHERE dataset_id = ? AND stop_lat BETWEEN ? AND ? AND stop_lon BETWEEN ? AND ? AND COALESCE(location_type, 0) = 0
        ORDER BY ((stop_lat - ?) * (stop_lat - ?)) + ((stop_lon - ?) * (stop_lon - ?)) LIMIT 200
      `).bind(row.dataset_id, options.latitude - latitudeDelta, options.latitude + latitudeDelta, options.longitude - longitudeDelta, options.longitude + longitudeDelta, options.latitude, options.latitude, options.longitude, options.longitude).all<StopRow>();
      candidates = result.results;
      if (candidates.length >= options.limit) break;
    }
  } catch (error: unknown) {
    throw new MetroError("internal_error", "The nearby stop query failed.", { cause: error });
  }
  const location = { latitude: options.latitude, longitude: options.longitude };
  return {
    location,
    stops: candidates.map((row) => ({ ...stopFromRow(row), distanceMeters: distanceMeters(location, { latitude: row.stop_lat, longitude: row.stop_lon }) }))
      .sort((left, right) => left.distanceMeters - right.distanceMeters || left.name.localeCompare(right.name)).slice(0, options.limit),
    source,
  };
}

export async function getRoute(db: D1Database, routeId: string): Promise<TransitRoute | null> {
  const { row } = await requireDataset(db);
  const route = await db.prepare(`SELECT route_id, route_short_name, route_long_name, route_desc, route_type, route_color, route_text_color FROM gtfs_routes WHERE dataset_id = ? AND route_id = ?`).bind(row.dataset_id, routeId).first<RouteRow>();
  return route ? routeFromRow(route) : null;
}

export async function getStop(db: D1Database, stopId: string): Promise<TransitStop | null> {
  const { row } = await requireDataset(db);
  const stop = await db.prepare(`SELECT stop_id, stop_code, stop_name, stop_desc, stop_lat, stop_lon, location_type, parent_station, wheelchair_boarding FROM gtfs_stops WHERE dataset_id = ? AND stop_id = ?`).bind(row.dataset_id, stopId).first<StopRow>();
  return stop ? stopFromRow(stop) : null;
}

export async function getCatalogReadiness(db: D1Database): Promise<{ ready: boolean; source: SourceMetadata | null }> {
  try {
    const row = await db.prepare(activeDatasetSql).first<DatasetRow>();
    return { ready: Boolean(row), source: row ? toSource(row) : null };
  } catch {
    return { ready: false, source: null };
  }
}
