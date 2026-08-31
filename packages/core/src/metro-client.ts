import { MetroError } from "./errors.js";
import type { MetroLogger } from "./provider.js";

export type MetroFeedAlias = "alerts" | "alertRoutes" | "tripUpdates";

export interface MetroFetchResult<T> {
  data: T;
  retrievedAt: string;
  contentType: string | null;
  durationMs: number;
}

export interface MetroLiveClient {
  getAlertsJson(): Promise<MetroFetchResult<unknown>>;
  getAlertRoutesJson(): Promise<MetroFetchResult<unknown>>;
  getTripUpdatesBytes(): Promise<MetroFetchResult<Uint8Array>>;
}

interface ClientOptions {
  baseUrl: string;
  apiKey: string | undefined;
  requestId: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  logger: MetroLogger;
}

const feeds = {
  alerts: { path: "/v2alerts/alerts", accept: "application/json", format: "json", maxBytes: 2 * 1024 * 1024 },
  alertRoutes: { path: "/v2alerts/routes", accept: "application/json", format: "json", maxBytes: 2 * 1024 * 1024 },
  tripUpdates: { path: "/GtfsRealtime/TripUpdates", accept: "application/x-protobuf", format: "protobuf", maxBytes: 5 * 1024 * 1024 },
} as const;

async function readBoundedBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > maxBytes) {
    throw new MetroError("invalid_response", "METRO returned a response larger than allowed.");
  }
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel("Response exceeded the configured size limit.");
        throw new MetroError("invalid_response", "METRO returned a response larger than allowed.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export function createMetroLiveClient(options: ClientOptions): MetroLiveClient {
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? 8_000;

  async function fetchFeed(feed: MetroFeedAlias): Promise<MetroFetchResult<Uint8Array>> {
    if (!options.apiKey?.trim()) {
      throw new MetroError("configuration", "The METRO GTFS subscription key is not configured.");
    }
    const definition = feeds[feed];
    const url = new URL(definition.path, options.baseUrl);
    url.searchParams.set("subscription-key", options.apiKey);
    const startedAt = performance.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;

    try {
      response = await fetcher(url, { headers: { Accept: definition.accept }, signal: controller.signal });
    } catch (error: unknown) {
      clearTimeout(timeout);
      const code = controller.signal.aborted ? "timeout" : "upstream";
      options.logger.error({ event: "metro_fetch_failed", requestId: options.requestId, feed, code, durationMs: Math.round(performance.now() - startedAt) });
      throw new MetroError(code, code === "timeout" ? "The METRO request timed out." : "The METRO request failed.", { cause: error });
    }

    if (!response.ok) {
      clearTimeout(timeout);
      options.logger.error({ event: "metro_fetch_failed", requestId: options.requestId, feed, code: "upstream", status: response.status, durationMs: Math.round(performance.now() - startedAt) });
      throw new MetroError(response.status === 429 ? "rate_limited" : "upstream", "METRO returned an unsuccessful response.");
    }

    const contentType = response.headers.get("content-type");
    const normalizedType = contentType?.toLowerCase() ?? "";
    if (definition.format === "json" && !normalizedType.includes("json")) {
      clearTimeout(timeout);
      throw new MetroError("invalid_response", "METRO returned an unexpected response format.");
    }
    if (definition.format === "protobuf" && !/protobuf|octet-stream/.test(normalizedType)) {
      clearTimeout(timeout);
      throw new MetroError("invalid_response", "METRO returned an unexpected response format.");
    }

    let data: Uint8Array;
    try {
      data = await readBoundedBody(response, definition.maxBytes);
    } catch (error: unknown) {
      if (error instanceof MetroError) throw error;
      const code = controller.signal.aborted ? "timeout" : "upstream";
      throw new MetroError(code, code === "timeout" ? "The METRO response timed out." : "The METRO response could not be read.", { cause: error });
    } finally {
      clearTimeout(timeout);
    }
    const durationMs = Math.round(performance.now() - startedAt);
    options.logger.log({ event: "metro_fetch_complete", requestId: options.requestId, feed, status: response.status, bytes: data.byteLength, durationMs });
    return { data, retrievedAt: new Date().toISOString(), contentType, durationMs };
  }

  async function getJson(feed: "alerts" | "alertRoutes"): Promise<MetroFetchResult<unknown>> {
    const result = await fetchFeed(feed);
    try {
      return { ...result, data: JSON.parse(new TextDecoder().decode(result.data)) as unknown };
    } catch (error: unknown) {
      throw new MetroError("invalid_response", "METRO returned malformed JSON.", { cause: error });
    }
  }

  return {
    getAlertsJson: () => getJson("alerts"),
    getAlertRoutesJson: () => getJson("alertRoutes"),
    getTripUpdatesBytes: () => fetchFeed("tripUpdates"),
  };
}
