# Architecture

## System shape

```text
MCP client ── stdio ──> Node adapter ── HTTPS ─┐
                                               │
MCP client ─ Streamable HTTP ──────────────> Worker ──> METRO live feeds
Browser ─ read-only JSON + static assets ────> │       - GTFS Realtime Trip Updates
                                               │       - V2 Alerts JSON
                                               └──────> D1 Static GTFS catalog
```

The MCP server factory depends only on the `MetroDataProvider` interface. Transports do not know how METRO data is fetched or stored, and providers do not know whether a request came from MCP, stdio, HTTP, or the showcase.

## Workspace boundaries

- `packages/core`: Zod schemas, normalized domain types, stable errors, provider interface, bounded live-feed client, protobuf/JSON normalization, and the HTTP gateway provider used by the CLI.
- `packages/mcp`: one transport-independent server factory that registers all tools and resources.
- `apps/cli`: a minimal stdio entry point. It connects to a configured hosted Worker and never writes protocol data to standard output except MCP messages.
- `apps/worker`: D1 catalog queries, METRO live-feed composition, REST handlers, stateless Streamable HTTP MCP, rate limiting, and static asset delivery.
- `apps/web`: React/Vite single page with install guidance and a compact stop-to-arrivals workflow. It only calls same-origin read-only endpoints.

## Data flow

Static GTFS is downloaded outside request handling and converted into deterministic SQL. D1 answers route, stop, nearby, and resource lookups. Trip Updates are decoded per request for arrivals; V2 Alerts JSON is normalized per request for disruptions. Every result carries source metadata, including retrieval time and feed freshness when the source supplies it.

The showcase performs manual requests only. It never receives a METRO key, embeds an authenticated feed URL, or continuously polls.

## Reliability and safety

- All public inputs and normalized outputs are Zod validated.
- Catalog and live-result limits are hard bounded.
- Live responses have content-type and body-size checks.
- A single abort signal covers response headers and body consumption.
- Errors expose a stable code, safe message, and request ID—not keys, upstream bodies, or authenticated URLs.
- Static catalog responses use edge caching; alerts use short caching; realtime arrivals use `no-store`.
- `/api/*` and `/mcp` are protected by a Cloudflare Rate Limiting binding.
- Secrets are Worker secrets or ignored local variables; only `PUBLIC_GITHUB_URL` is browser-visible configuration.

## Deployment model

The Worker is stateless. `createMcpHandler` creates a fresh MCP server for each Streamable HTTP request, so no session or Durable Object is required. Static assets are served by the Workers Assets binding, while `/mcp` and `/api/*` execute the Worker first.
