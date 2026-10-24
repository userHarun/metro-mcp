import type { WorkerEnv } from "./env.js";

export async function enforceRateLimit(request: Request, env: WorkerEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) return null;
  const actor = request.headers.get("CF-Connecting-IP") ?? "anonymous";
  const endpoint = url.pathname.split("/")[2] ?? "unknown";
  const result = await env.PUBLIC_RATE_LIMITER.limit({ key: `${endpoint}:${actor}` });
  if (result.success) return null;
  return Response.json(
    { error: "rate_limited", message: "Too many requests. Try again shortly." },
    { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "60" } },
  );
}
