import { createMetroLiveClient, MetroError, type MetroLogger } from "@metro/core";
import { describe, expect, it } from "vitest";

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
    const client = createMetroLiveClient({
      baseUrl: "https://api.ridemetro.org", apiKey: secret, requestId: "r2", logger,
      fetcher: async () => new Response(`provider rejected ${secret}`, { status: 401 }),
    });
    let caught: unknown;
    try { await client.getAlertsJson(); } catch (error: unknown) { caught = error; }
    expect(caught).toBeInstanceOf(MetroError);
    expect(JSON.stringify(caught)).not.toContain(secret);
    expect(JSON.stringify(records)).not.toContain(secret);
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
