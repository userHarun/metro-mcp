# Houston METRO MCP

A typed Model Context Protocol server and compact transit-data web app for Houston METRO. It exposes route and stop search from Static GTFS, next arrivals from GTFS Realtime Trip Updates, and disruptions from the V2 Alerts feed.

## What is included

- MCP over local stdio and stateless Streamable HTTP at `/mcp`
- Five read-only transit tools and three MCP resources
- D1-backed route, stop, and nearby-stop catalog
- Bounded, timeout-aware METRO clients with Zod-validated results
- React landing page with installation snippets and a next-arrivals showcase
- Worker, in-memory MCP, normalization, and security-oriented tests

## Requirements

- Node.js 22 or newer
- pnpm 11
- A Houston METRO developer subscription for the GTFS and Transit Data products
- A Cloudflare account only when deploying the hosted service

## Local setup

```powershell
pnpm install
Copy-Item .dev.vars.example .dev.vars
pnpm gtfs:setup:local
pnpm dev:worker
```

Set the real values in the ignored `.dev.vars` file:

```dotenv
METRO_GTFS_API_KEY=your-gtfs-key
METRO_TRANSIT_DATA_API_KEY=your-transit-data-key
```

The Worker and web app run together through Wrangler. `gtfs:setup:local` applies the D1 schema, downloads and converts Static GTFS, then seeds the local catalog. To work on the visual shell without live data, run `pnpm dev`.

## MCP clients

Build the packages and CLI first:

```powershell
pnpm build
```

Claude Desktop configuration:

```json
{
  "mcpServers": {
    "houston-metro": {
      "command": "node",
      "args": ["C:/absolute/path/to/metro-mcp/apps/cli/dist/index.js"],
      "env": {
        "METRO_SERVICE_URL": "https://your-worker.example.workers.dev"
      }
    }
  }
}
```

Cursor configuration uses the same `mcpServers` object. Hosted MCP clients can connect directly to `https://your-worker.example.workers.dev/mcp`.

## Public surface

| Kind | Name | Purpose |
| --- | --- | --- |
| Tool | `search_routes` | Search routes by ID, short name, or long name |
| Tool | `search_stops` | Search stops by ID, code, or name |
| Tool | `find_nearby_stops` | Find the nearest stops to coordinates |
| Tool | `get_next_arrivals` | Read upcoming stop arrivals with an optional route filter |
| Tool | `get_service_alerts` | Read active service alerts with an optional route filter |
| Resource | `metro://system/data-sources` | Feed readiness and attribution |
| Resource | `metro://routes/{routeId}` | One normalized route record |
| Resource | `metro://stops/{stopId}` | One normalized stop record |

The browser-facing API is also read-only: `/api/health`, `/api/config`, `/api/data-sources`, `/api/routes/search`, `/api/stops/search`, `/api/stops/nearby`, `/api/arrivals`, `/api/alerts`, `/api/routes/:routeId`, and `/api/stops/:stopId`.

## Quality checks

```powershell
pnpm check
pnpm deploy:dry-run
```

`pnpm check` generates Worker binding types, compiles every workspace, runs linting and both test suites, and performs production builds.

## Deployment

1. Create a D1 database and replace the placeholder ID in `wrangler.jsonc`.
2. Apply `migrations/0001_static_gtfs_catalog.sql` remotely.
3. Generate the Static GTFS SQL and import it with `wrangler d1 execute`.
4. Store both API keys with `wrangler secret put`.
5. Set `PUBLIC_GITHUB_URL` and run `pnpm deploy`.

Never put API keys in `wrangler.jsonc`, client configuration, browser environment variables, logs, or committed files.

## Architecture

See [Architecture](docs/ARCHITECTURE.md), [Public contracts](docs/CONTRACTS.md), and [Legacy audit](docs/LEGACY_AUDIT.md). The transport-independent MCP factory lives in `packages/mcp`; `packages/core` owns domain contracts and provider clients; the CLI and Worker are thin adapters.

## Attribution

Transit data is provided by the Metropolitan Transit Authority of Harris County, Texas (METRO). See the [Houston METRO Transit Data portal](https://api-portal.ridemetro.org/). METRO trademarks and service marks remain the property of METRO; this independent project is not an official METRO product.

## License

MIT
