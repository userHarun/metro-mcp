#!/usr/bin/env node
import { homedir } from "node:os";
import { join } from "node:path";
import type { MetroLogger } from "@metro/core";
import { createLocalMetroProvider } from "@metro/local";
import { createMetroMcpServer } from "@metro/mcp";
import { serveStdio } from "@modelcontextprotocol/server/stdio";

function cacheDirectory(): string {
  const configured = process.env.METRO_CACHE_DIR?.trim();
  if (configured) return configured;
  const localAppData = process.env.LOCALAPPDATA?.trim();
  return localAppData
    ? join(localAppData, "houston-metro-mcp")
    : join(homedir(), ".cache", "houston-metro-mcp");
}

const logger: MetroLogger = {
  log(fields) { console.error(JSON.stringify(fields)); },
  error(fields) { console.error(JSON.stringify(fields)); },
};

const provider = createLocalMetroProvider({
  apiKey: process.env.METRO_GTFS_API_KEY,
  cacheDirectory: cacheDirectory(),
  logger,
  ...(process.env.METRO_API_BASE_URL?.trim() ? { baseUrl: process.env.METRO_API_BASE_URL.trim() } : {}),
  ...(process.env.METRO_STATIC_GTFS_URL?.trim() ? { staticGtfsUrl: process.env.METRO_STATIC_GTFS_URL.trim() } : {}),
});
const handle = serveStdio(() => createMetroMcpServer(provider));

async function shutdown(): Promise<void> {
  await handle.close();
  process.exit(0);
}

process.once("SIGINT", () => { void shutdown(); });
process.once("SIGTERM", () => { void shutdown(); });
console.error("Houston METRO MCP is running locally over stdio.");
