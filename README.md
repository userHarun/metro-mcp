# Houston METRO MCP

A local Model Context Protocol server for Houston METRO routes, stops, realtime arrivals, and service alerts.

The MCP runs on your computer through stdio. Your AI client starts it when needed, and your METRO API key is used directly by the local process—there is no hosted MCP service in between.

## Available tools

- `search_routes` — find routes by number or name
- `search_stops` — find stops by code or name
- `find_nearby_stops` — find stops closest to a latitude and longitude
- `get_next_arrivals` — get realtime arrivals for a stop, optionally filtered by route
- `get_service_alerts` — get current system-wide or route-specific alerts

The server also exposes route, stop, and data-source resources under the `metro://` URI scheme.

## Requirements

- Node.js 22 or newer
- pnpm 11
- A Houston METRO GTFS API subscription key from the [METRO Transit Data portal](https://api-portal.ridemetro.org/)

## Install

After cloning this repository, open a terminal in the repository and run:

```powershell
pnpm install
pnpm build
```

The local MCP entry point is:

```text
apps/cli/dist/index.js
```

Use its absolute path in your MCP client configuration.

## Claude Desktop

Add the server to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "houston-metro": {
      "command": "node",
      "args": ["C:/absolute/path/to/metro-mcp/apps/cli/dist/index.js"],
      "env": {
        "METRO_GTFS_API_KEY": "YOUR_METRO_API_KEY"
      }
    }
  }
}
```

Restart Claude Desktop after saving the configuration.

## Cursor

Add the same local command to `.cursor/mcp.json` in a project or to Cursor’s global MCP configuration:

```json
{
  "mcpServers": {
    "houston-metro": {
      "command": "node",
      "args": ["C:/absolute/path/to/metro-mcp/apps/cli/dist/index.js"],
      "env": {
        "METRO_GTFS_API_KEY": "YOUR_METRO_API_KEY"
      }
    }
  }
}
```

Enable the server in Cursor’s MCP settings after saving the file.

## First use

The first route or stop request downloads METRO’s official Static GTFS archive and stores it in a local cache. Later sessions reuse that cache and refresh it automatically. Realtime arrival and alert requests go directly to METRO using your API key.

You do not need to start a website, Worker, database, or separate background service. Your MCP client launches and stops the local process automatically.

## Troubleshooting

- Use an absolute path to `apps/cli/dist/index.js`.
- Run `pnpm build` again after pulling updates.
- Confirm `node --version` reports Node 22 or newer.
- Restart the MCP client after changing its configuration.
- Confirm your METRO subscription key is active if realtime tools return a configuration or upstream error.

## Attribution

Transit data is provided by the Metropolitan Transit Authority of Harris County, Texas (METRO). METRO trademarks and service marks remain the property of METRO. This independent project is not an official METRO product.

## License

MIT
