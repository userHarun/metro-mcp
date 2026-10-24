import type { MetroLogger } from "@metro/core";
import { handleApi } from "./api.js";
import type { WorkerEnv } from "./env.js";
import { createWorkerProvider } from "./provider.js";
import { enforceRateLimit } from "./rate-limit.js";

function loggerFor(requestId: string): MetroLogger {
  return {
    log(fields) { console.log(JSON.stringify({ ...fields, requestId })); },
    error(fields) { console.error(JSON.stringify({ ...fields, requestId })); },
  };
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    const requestId = request.headers.get("CF-Ray") ?? crypto.randomUUID();
    const logger = loggerFor(requestId);

    try {
      const limited = await enforceRateLimit(request, env);
      if (limited) return limited;
      const provider = createWorkerProvider(env, requestId, logger);

      if (url.pathname.startsWith("/api/")) return await handleApi(request, env, provider, requestId);
      return await env.ASSETS.fetch(request);
    } catch (error: unknown) {
      logger.error({ event: "unhandled_request_error", path: url.pathname, error: error instanceof Error ? error.name : "unknown" });
      return Response.json({ error: "internal_error", message: "The request could not be completed.", requestId }, { status: 500 });
    }
  },
} satisfies ExportedHandler<WorkerEnv>;
