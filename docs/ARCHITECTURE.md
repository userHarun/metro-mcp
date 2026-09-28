# Architecture

## System shape

```text
MCP client ── stdio ──> local Node MCP ──> local GTFS cache
                              └───────────> METRO realtime feeds

Browser ──> separately deployed showcase Worker ──> D1 + METRO feeds
```

The local MCP and public showcase share schemas and normalization, but neither depends on the other. The MCP server factory depends only on the `MetroDataProvider` interface.

## Workspace boundaries

- `packages/core`: Zod schemas, normalized domain types, stable errors, provider interface, bounded live-feed client, and protobuf/JSON normalization.
- `packages/local`: Node-only Static GTFS cache, in-memory catalog search, and the direct local provider.
- `packages/mcp`: one transport-independent server factory that registers all tools and resources.
- `apps/cli`: the local stdio entry point. It uses the user's METRO key directly and writes only MCP messages to standard output.
- `apps/worker`: the website's D1 catalog, read-only showcase API, rate limiting, and static asset delivery. It does not expose MCP.
- `apps/web`: React/Vite single page with install guidance and a compact stop-to-arrivals workflow. It only calls same-origin read-only endpoints.

## Data flow

On first catalog use, the local MCP downloads the official Static GTFS ZIP into the user's cache directory, validates it, and builds an in-memory route/stop index. Later processes reuse and periodically refresh the cache. A selected rail route can lazily load GTFS trips, stop times, and service calendars from that archive for scheduled arrivals. Trip Updates and V2 Alerts are fetched directly from METRO with the user's key.

The website uses a separate D1 import and Worker API so visitors can try the showcase without installing the MCP. The import stores rail stop times and service calendars alongside the route and stop catalog. That deployment is not part of the local MCP runtime.

The showcase performs manual requests only. It never receives a METRO key, embeds an authenticated feed URL, or continuously polls.

## Reliability and safety

- All public inputs and normalized outputs are Zod validated.
- Catalog and live-result limits are hard bounded.
- Live responses have content-type and body-size checks.
- A single abort signal covers response headers and body consumption.
- Errors expose a stable code, safe message, and request ID—not keys, upstream bodies, or authenticated URLs.
- The local Static GTFS archive is cached on disk; no API key is written to that cache.
- The website's `/api/*` routes are protected by a Cloudflare Rate Limiting binding.
- MCP credentials are supplied by the user's MCP client and remain local to that process.

## Runtime model

The MCP is local stdio only: the client starts one process per MCP session and stops it when the session ends. The website can be deployed independently without changing how users install or run the MCP.
