import { createMetroMcpServer } from "@metro/mcp";
import type { MetroLogger } from "@metro/core";
import { createMcpHandler } from "agents/mcp/server";
import { handleApi } from "./api.js";
import { createWorkerProvider } from "./provider.js";

function loggerFor(requestId: string): MetroLogger {
  return {
    log(fields) { console.log(JSON.stringify({ ...fields, requestId })); },
    error(fields) { console.error(JSON.stringify({ ...fields, requestId })); },
  };
}

async function enforceRateLimit(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/") && url.pathname !== "/mcp") return null;
  const actor = request.headers.get("CF-Connecting-IP") ?? request.headers.get("User-Agent") ?? "anonymous";
  const result = await env.PUBLIC_RATE_LIMITER.limit({ key: `${url.pathname.split("/")[1]}:${actor}` });
  if (result.success) return null;
  return Response.json(
    { error: "rate_limited", message: "Too many requests. Try again shortly." },
    { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "60" } },
  );
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const requestId = request.headers.get("CF-Ray") ?? crypto.randomUUID();
    const logger = loggerFor(requestId);

    try {
      const limited = await enforceRateLimit(request, env);
      if (limited) return limited;
      const provider = createWorkerProvider(env, requestId, logger);

      if (url.pathname === "/mcp") {
        const handler = createMcpHandler(() => createMetroMcpServer(provider), {
          route: "/mcp",
          legacy: "stateless",
          corsOptions: { origin: "*", methods: "GET, POST, DELETE, OPTIONS" },
        });
        return await handler(request, env, ctx);
      }
      if (url.pathname.startsWith("/api/")) return await handleApi(request, env, provider, requestId);
      return await env.ASSETS.fetch(request);
    } catch (error: unknown) {
      logger.error({ event: "unhandled_request_error", path: url.pathname, error: error instanceof Error ? error.message : "unknown" });
      return Response.json({ error: "internal_error", message: "The request could not be completed.", requestId }, { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;
