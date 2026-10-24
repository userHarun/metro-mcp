import { enforceRateLimit } from "../apps/worker/src/rate-limit.js";
import type { WorkerEnv } from "../apps/worker/src/env.js";
import { describe, expect, it } from "vitest";

describe("Worker rate limit keys", () => {
  it("uses the API resource and connecting IP, ignoring user agents", async () => {
    const keys: string[] = [];
    const env = {
      PUBLIC_RATE_LIMITER: { limit: async ({ key }: { key: string }) => { keys.push(key); return { success: true }; } },
    } as unknown as WorkerEnv;
    await enforceRateLimit(new Request("https://example.com/api/routes/search", { headers: { "CF-Connecting-IP": "192.0.2.1", "User-Agent": "first" } }), env);
    await enforceRateLimit(new Request("https://example.com/api/alerts", { headers: { "CF-Connecting-IP": "192.0.2.1", "User-Agent": "second" } }), env);
    await enforceRateLimit(new Request("https://example.com/api/stops/search", { headers: { "User-Agent": "spoofed" } }), env);
    expect(keys).toEqual(["routes:192.0.2.1", "alerts:192.0.2.1", "stops:anonymous"]);
  });
});
