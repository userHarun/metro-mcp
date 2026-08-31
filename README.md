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

## Run the website

From this repository:

```powershell
pnpm install
Copy-Item .dev.vars.example .dev.vars
```

Add your METRO keys to the ignored `.dev.vars` file:

```dotenv
METRO_GTFS_API_KEY=your-gtfs-key
METRO_TRANSIT_DATA_API_KEY=your-transit-data-key
```

Prepare the local route and stop catalog once:

```powershell
pnpm gtfs:setup:local
```

Then start the website and MCP server together:

```powershell
pnpm dev:worker
```

Open [http://localhost:8787](http://localhost:8787). The landing page and arrivals showcase use the same local Worker as the MCP endpoint at `http://localhost:8787/mcp`.

On later runs, only `pnpm dev:worker` is needed unless the GTFS catalog needs to be refreshed. `pnpm dev` starts the visual frontend alone on `http://localhost:5173`, but its live transit widget requires the Worker.

## Connect an MCP client

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
        "METRO_SERVICE_URL": "http://localhost:8787"
      }
    }
  }
}
```

Keep `pnpm dev:worker` running while using this local configuration. Cursor can connect directly to the local Streamable HTTP endpoint:

```json
{
  "mcpServers": {
    "houston-metro": {
      "url": "http://localhost:8787/mcp"
    }
  }
}
```

If this MCP is hosted later, replace the localhost address with its public base URL.

## MCP surface

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

## Quality checks

```powershell
pnpm check
```

`pnpm check` generates Worker binding types, compiles every workspace, runs linting and both test suites, and performs production builds.

Never put API keys in `wrangler.jsonc`, client configuration, browser environment variables, logs, or committed files.

## Architecture

See [Architecture](docs/ARCHITECTURE.md), [Public contracts](docs/CONTRACTS.md), and [Legacy audit](docs/LEGACY_AUDIT.md). The transport-independent MCP factory lives in `packages/mcp`; `packages/core` owns domain contracts and provider clients; the CLI and Worker are thin adapters.

## Attribution

Transit data is provided by the Metropolitan Transit Authority of Harris County, Texas (METRO). See the [Houston METRO Transit Data portal](https://api-portal.ridemetro.org/). METRO trademarks and service marks remain the property of METRO; this independent project is not an official METRO product.

## License

MIT
