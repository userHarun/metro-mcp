#!/usr/bin/env node
import { createGatewayProvider } from "@metro/core";
import { createMetroMcpServer } from "@metro/mcp";
import { serveStdio } from "@modelcontextprotocol/server/stdio";

const baseUrl = process.env.METRO_SERVICE_URL?.trim() || "http://localhost:8787";

try {
  new URL(baseUrl);
} catch {
  console.error("METRO_SERVICE_URL must be a valid absolute URL.");
  process.exitCode = 1;
  throw new Error("Invalid METRO_SERVICE_URL");
}

const provider = createGatewayProvider({ baseUrl });
const handle = serveStdio(() => createMetroMcpServer(provider));

async function shutdown(): Promise<void> {
  await handle.close();
  process.exit(0);
}

process.once("SIGINT", () => { void shutdown(); });
process.once("SIGTERM", () => { void shutdown(); });
console.error(`Houston METRO MCP is running over stdio using ${baseUrl}.`);
