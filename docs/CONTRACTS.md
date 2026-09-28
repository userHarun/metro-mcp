# Public contracts

These names and limits are the initial stable surface for version `0.1.x`.

## MCP tools

| Tool | Inputs | Limit | Result |
| --- | --- | --- | --- |
| `search_routes` | `query` 1–80 chars; optional `limit` | 1–20, default 10 | query, normalized routes, source |
| `search_stops` | `query` 2–100 chars; optional `railRouteId`, `limit` | 1–20, default 10 | query, normalized stops, source |
| `find_nearby_stops` | latitude, longitude; optional `limit` | 1–10, default 5 | coordinates, distance-sorted stops, source |
| `get_next_arrivals` | `stopId`; optional `routeId`, `limit` | 1–10, default 5 | time-sorted live arrivals, feed coverage, optional rail schedule, source |
| `get_service_alerts` | optional `routeId` | bounded upstream feed | normalized alerts, source |

Coordinates must be valid WGS84 latitude and longitude. Identifiers are treated as opaque strings and exact identifiers are preserved.

## MCP resources

- `metro://system/data-sources`
- `metro://routes/{routeId}`
- `metro://stops/{stopId}`

Resource bodies are UTF-8 JSON. Missing route or stop resources return `not_found` through the MCP error path.

## Source metadata

Every transit result includes:

- `provider`: always `Houston METRO`
- `feed`: `static-gtfs`, `gtfs-realtime-trip-updates`, or `v2-alerts-json`
- `retrievedAt`: service retrieval time
- `feedTimestamp`, `ageSeconds`, and `isStale` when available
- `datasetVersion`, `serviceStartDate`, and `serviceEndDate` for Static GTFS when available

`get_next_arrivals` includes `coverage.routeTripUpdates` and `coverage.stopTimeUpdates`. When a selected rail route has no live prediction, `schedule` may contain upcoming Static GTFS times with its own source metadata. A scheduled time is never presented as a realtime prediction. The rail schedule uses `America/Chicago` service dates, GTFS times beyond midnight, weekly calendars, and date exceptions.

## Browser API

All endpoints are `GET` only.

| Route | Cache policy |
| --- | --- |
| `/api/health`, `/api/arrivals` | `no-store` |
| `/api/alerts` | browser 10s, edge 15s, stale 30s |
| catalog, configuration, and data-source routes | browser 60s, edge 300s, stale 3600s |

Successful endpoints return normalized JSON. Failures return `{ error, message, requestId }` without an upstream response body.

## Stable error codes

- `configuration`: a server-side key or required setting is missing
- `invalid_request`: validation failed
- `timeout`: the upstream deadline expired
- `upstream`: METRO could not be reached or returned an unsuccessful status
- `invalid_response`: the upstream type, size, JSON, or protobuf was invalid
- `catalog_not_ready`: the local GTFS cache or showcase D1 catalog could not be initialized
- `not_found`: an exact catalog resource is missing
- `rate_limited`: the service or upstream rejected request volume
- `internal_error`: an unexpected safe fallback

For the separate showcase API, HTTP status mapping is 400 for invalid requests, 404 for missing resources, 429 for limits, 502 for upstream/response errors, 503 for configuration/catalog readiness, 504 for timeout, and 500 for unexpected failures.
