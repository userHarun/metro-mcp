import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { installationCopy, mcpClientConfigs } from "../apps/web/src/install-config";

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

describe("web installation content", () => {
  it("keeps installation headings free of markdown and encoded whitespace", () => {
    const copy = Object.values(installationCopy).join(" ");

    expect(copy).not.toMatch(/\*\*|(^|\s)##\s|&#x20;/);
  });

  it("shows client-specific MCP configurations", () => {
    const claude = JSON.parse(mcpClientConfigs.claude);
    const cursor = JSON.parse(mcpClientConfigs.cursor);

    expect(mcpClientConfigs.claude).not.toBe(mcpClientConfigs.cursor);
    expect(claude.mcpServers["houston-metro"]).toEqual({
      command: "node",
      args: ["C:/absolute/path/to/metro-mcp/apps/cli/dist/index.js"],
      env: { METRO_GTFS_API_KEY: "YOUR_METRO_API_KEY" },
    });
    expect(cursor.mcpServers["houston-metro"]).toEqual({
      type: "stdio",
      command: "node",
      args: ["${workspaceFolder}/apps/cli/dist/index.js"],
      env: { METRO_GTFS_API_KEY: "${env:METRO_GTFS_API_KEY}" },
    });
  });

  it("documents the Cursor-specific configuration in the README", () => {
    expect(readme).toContain('"type": "stdio"');
    expect(readme).toContain('"${workspaceFolder}/apps/cli/dist/index.js"');
    expect(readme).toContain('"${env:METRO_GTFS_API_KEY}"');
    expect(readme).not.toContain("Add the same local command");
    expect(readme).not.toContain("&#x20;");
  });
});
