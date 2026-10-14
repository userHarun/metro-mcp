export const installationCopy = {
  eyebrow: "Installation",
  heading: "Connect the local MCP",
  description: "After cloning and building the project, add its local command to your MCP client.",
} as const;

const serverPath = "C:/absolute/path/to/metro-mcp/apps/cli/dist/index.js";

export const mcpClientConfigs = {
  claude: JSON.stringify(
    {
      mcpServers: {
        "houston-metro": {
          command: "node",
          args: [serverPath],
          env: { METRO_GTFS_API_KEY: "YOUR_METRO_API_KEY" },
        },
      },
    },
    null,
    2,
  ),
  cursor: JSON.stringify(
    {
      mcpServers: {
        "houston-metro": {
          type: "stdio",
          command: "node",
          args: ["${workspaceFolder}/apps/cli/dist/index.js"],
          env: { METRO_GTFS_API_KEY: "${env:METRO_GTFS_API_KEY}" },
        },
      },
    },
    null,
    2,
  ),
} as const;
