import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { createMetroLiveClient, MetroError, MetroLiveCache, type MetroLogger } from "@metro/core";
import { describe, expect, it, vi } from "vitest";

function recordingLogger(): { logger: MetroLogger; records: Array<Record<string, unknown>> } {
  const records: Array<Record<string, unknown>> = [];
  return {
    records,
    logger: { log: (fields) => records.push(fields), error: (fields) => records.push(fields) },
  };
}

describe("METRO live client", () => {
  it("rejects missing credentials before sending a request", async () => {
    const { logger } = recordingLogger();
    const client = createMetroLiveClient({ baseUrl: "https://api.ridemetro.org", apiKey: undefined, requestId: "r1", logger });
    await expect(client.getAlertsJson()).rejects.toMatchObject({ code: "configuration" });
  });

  it("does not expose a key or upstream body in errors and logs", async () => {
    const secret = "super-secret-subscription-key";
    const { logger, records } = recordingLogger();
    let requestedUrl = "";
    let requestHeaders: Headers | null = null;
    const client = createMetroLiveClient({
      baseUrl: "https://api.ridemetro.org", apiKey: secret, requestId: "r2", logger,
      fetcher: async (input, init) => {
        requestedUrl = String(input);
        requestHeaders = new Headers(init?.headers);
        throw new Error(`provider rejected ${secret} at ${requestedUrl}`);
      },
    });
    let caught: unknown;
    try { await client.getAlertsJson(); } catch (error: unknown) { caught = error; }
    expect(caught).toBeInstanceOf(MetroError);
    expect(requestedUrl).not.toContain(secret);
    expect(requestHeaders?.get("Ocp-Apim-Subscription-Key")).toBe(secret);
    expect((caught as Error).message).not.toContain(secret);
    expect(String((caught as Error).cause)).not.toContain(secret);
    for (const record of records) {
      for (const value of Object.values(record)) expect(String(value)).not.toContain(secret);
    }

    const rejected = createMetroLiveClient({
      baseUrl: "https://api.ridemetro.org", apiKey: secret, requestId: "r2b", logger,
      fetcher: async () => new Response(`provider rejected ${secret}`, { status: 401 }),
    });
    let rejectedError: unknown;
    try { await rejected.getAlertsJson(); } catch (error: unknown) { rejectedError = error; }
    expect((rejectedError as Error).message).not.toContain(secret);
    expect(String((rejectedError as Error).cause)).not.toContain(secret);
    for (const record of records) {
      for (const value of Object.values(record)) expect(String(value)).not.toContain(secret);
    }
  });

  it("coalesces parsed trip updates, caches them briefly, and revalidates with ETag", async () => {
    const { logger } = recordingLogger();
    const bytes = GtfsRealtimeBindings.transit_realtime.FeedMessage.encode({
      header: { gtfsRealtimeVersion: "2.0" }, entity: [],
    }).finish();
    let now = 1_000_000;
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (headers.has("If-None-Match")) {
        expect(headers.get("If-None-Match")).toBe('"v1"');
        return new Response(null, { status: 304 });
      }
      return new Response(bytes, { headers: { "Content-Type": "application/x-protobuf", ETag: '"v1"' } });
    });
    const client = createMetroLiveClient({ baseUrl: "https://api.ridemetro.org", apiKey: "test", requestId: "r6", logger, fetcher, now: () => now });
    const [first, second] = await Promise.all([client.getTripUpdatesFeed!(), client.getTripUpdatesFeed!()]);
    expect(first.data).toBe(second.data);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await client.getTripUpdatesFeed!();
    expect(fetcher).toHaveBeenCalledTimes(1);
    now += 15_000;
    const refreshed = await client.getTripUpdatesFeed!();
    expect(refreshed.data).toBe(first.data);
    expect(refreshed.retrievedAt).not.toBe(first.retrievedAt);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("retries a rate limit response using Retry-After", async () => {
    const { logger } = recordingLogger();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { "Retry-After": "0" } }))
      .mockResolvedValueOnce(new Response("{}", { headers: { "Content-Type": "application/json" } }));
    const client = createMetroLiveClient({ baseUrl: "https://api.ridemetro.org", apiKey: "test", requestId: "r7", logger, fetcher });
    await expect(client.getAlertsJson()).resolves.toMatchObject({ data: {} });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not retry beyond the request deadline when Retry-After is long", async () => {
    const { logger } = recordingLogger();
    const fetcher = vi.fn(async () => new Response(null, { status: 429, headers: { "Retry-After": "60" } }));
    const client = createMetroLiveClient({ baseUrl: "https://api.ridemetro.org", apiKey: "test", requestId: "r8", logger, fetcher, timeoutMs: 50 });
    await expect(client.getAlertsJson()).rejects.toMatchObject({ code: "rate_limited" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("shares a scoped cache between clients without crossing credentials", async () => {
    const { logger } = recordingLogger();
    const fetcher = vi.fn(async () => new Response("{}", { headers: { "Content-Type": "application/json" } }));
    const cache = new MetroLiveCache("https://api.ridemetro.org", "first");
    const client = (apiKey: string) => createMetroLiveClient({
      baseUrl: "https://api.ridemetro.org", apiKey, requestId: "worker", logger, fetcher, cache,
    });
    await Promise.all([client("first").getAlertsJson(), client("first").getAlertsJson()]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await client("second").getAlertsJson();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed and oversized responses", async () => {
    const { logger } = recordingLogger();
    const malformed = createMetroLiveClient({
      baseUrl: "https://api.ridemetro.org", apiKey: "test", requestId: "r3", logger,
      fetcher: async () => new Response("not-json", { headers: { "Content-Type": "application/json" } }),
    });
    await expect(malformed.getAlertsJson()).rejects.toMatchObject({ code: "invalid_response" });

    const oversized = createMetroLiveClient({
      baseUrl: "https://api.ridemetro.org", apiKey: "test", requestId: "r4", logger,
      fetcher: async () => new Response("{}", { headers: { "Content-Type": "application/json", "Content-Length": String(3 * 1024 * 1024) } }),
    });
    await expect(oversized.getAlertsJson()).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("keeps the deadline active while the response body is streaming", async () => {
    const { logger } = recordingLogger();
    const client = createMetroLiveClient({
      baseUrl: "https://api.ridemetro.org", apiKey: "test", requestId: "r5", logger, timeoutMs: 10,
      fetcher: async (_input, init) => new Response(new ReadableStream({
        start(controller) {
          init?.signal?.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")), { once: true });
        },
      }), { headers: { "Content-Type": "application/json" } }),
    });
    await expect(client.getAlertsJson()).rejects.toMatchObject({ code: "timeout" });
  });
});
