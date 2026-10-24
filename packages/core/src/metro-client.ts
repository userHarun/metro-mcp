import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { MetroError } from "./errors.js";
import type { MetroLogger } from "./provider.js";

export type MetroFeedAlias = "alerts" | "alertRoutes" | "tripUpdates";
type FeedMessage = GtfsRealtimeBindings.transit_realtime.FeedMessage;

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
  getTripUpdatesFeed?(): Promise<MetroFetchResult<FeedMessage>>;
}

interface ClientOptions {
  baseUrl: string;
  apiKey: string | undefined;
  requestId: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  cacheTtlMs?: number;
  now?: () => number;
  cache?: MetroLiveCache;
  logger: MetroLogger;
}

interface FeedPayload {
  raw: MetroFetchResult<Uint8Array>;
  parsed: MetroFetchResult<unknown>;
  etag: string | null;
  expiresAt: number;
}

export class MetroLiveCache {
  readonly baseUrl: string;
  readonly apiKey: string | undefined;
  readonly entries = new Map<MetroFeedAlias, FeedPayload>();
  readonly inFlight = new Map<MetroFeedAlias, Promise<FeedPayload>>();

  constructor(baseUrl: string, apiKey: string | undefined) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }
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

function retryAfterMs(value: string | null, now: number): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

function waitForRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new MetroError("timeout", "The METRO request timed out.")); return; }
    const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, delayMs);
    function onAbort() {
      clearTimeout(timer);
      reject(new MetroError("timeout", "The METRO request timed out."));
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function createMetroLiveClient(options: ClientOptions): MetroLiveClient {
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? 8_000;
  const cacheTtlMs = options.cacheTtlMs ?? 15_000;
  const now = options.now ?? Date.now;
  const shared = options.cache?.baseUrl === options.baseUrl && options.cache.apiKey === options.apiKey
    ? options.cache
    : new MetroLiveCache(options.baseUrl, options.apiKey);
  const cache = shared.entries;
  const inFlight = shared.inFlight;

  async function fetchFeed(feed: MetroFeedAlias, previous?: FeedPayload): Promise<FeedPayload> {
    if (!options.apiKey?.trim()) {
      throw new MetroError("configuration", "The METRO GTFS subscription key is not configured.");
    }
    const definition = feeds[feed];
    const url = new URL(definition.path, options.baseUrl);
    const startedAt = performance.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const headers = new Headers({ Accept: definition.accept, "Ocp-Apim-Subscription-Key": options.apiKey });
    if (previous?.etag) headers.set("If-None-Match", previous.etag);

    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        let response: Response;
        try {
          response = await fetcher(url, { headers, signal: controller.signal });
        } catch {
          const code = controller.signal.aborted ? "timeout" : "upstream";
          options.logger.error({ event: "metro_fetch_failed", requestId: options.requestId, feed, code, durationMs: Math.round(performance.now() - startedAt) });
          throw new MetroError(code, code === "timeout" ? "The METRO request timed out." : "The METRO request failed.");
        }

        if (response.status === 304 && previous) {
          const retrievedAt = new Date(now()).toISOString();
          const durationMs = Math.round(performance.now() - startedAt);
          options.logger.log({ event: "metro_fetch_complete", requestId: options.requestId, feed, status: 304, bytes: 0, durationMs });
          return {
            raw: { ...previous.raw, retrievedAt, durationMs },
            parsed: { ...previous.parsed, retrievedAt, durationMs },
            etag: response.headers.get("etag") ?? previous.etag,
            expiresAt: now() + cacheTtlMs,
          };
        }

        if (response.status === 429 && attempt < 2) {
          const retryAfter = retryAfterMs(response.headers.get("retry-after"), now());
          const delayMs = retryAfter ?? Math.round((200 * 2 ** attempt) * (0.5 + Math.random()));
          await response.body?.cancel();
          if (delayMs < timeoutMs - (performance.now() - startedAt)) {
            await waitForRetry(delayMs, controller.signal);
            continue;
          }
        }

        if (!response.ok) {
          const code = response.status === 429 ? "rate_limited" : "upstream";
          options.logger.error({ event: "metro_fetch_failed", requestId: options.requestId, feed, code, status: response.status, durationMs: Math.round(performance.now() - startedAt) });
          throw new MetroError(code, "METRO returned an unsuccessful response.");
        }

        const contentType = response.headers.get("content-type");
        const normalizedType = contentType?.toLowerCase() ?? "";
        if (definition.format === "json" && !normalizedType.includes("json")) {
          throw new MetroError("invalid_response", "METRO returned an unexpected response format.");
        }
        if (definition.format === "protobuf" && !/protobuf|octet-stream/.test(normalizedType)) {
          throw new MetroError("invalid_response", "METRO returned an unexpected response format.");
        }

        let data: Uint8Array;
        try {
          data = await readBoundedBody(response, definition.maxBytes);
        } catch (error: unknown) {
          if (error instanceof MetroError) throw error;
          const code = controller.signal.aborted ? "timeout" : "upstream";
          throw new MetroError(code, code === "timeout" ? "The METRO response timed out." : "The METRO response could not be read.");
        }

        let parsed: unknown;
        try {
          parsed = definition.format === "json"
            ? JSON.parse(new TextDecoder().decode(data)) as unknown
            : GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(data);
        } catch {
          throw new MetroError("invalid_response", definition.format === "json" ? "METRO returned malformed JSON." : "METRO returned malformed GTFS Realtime data.");
        }
        const durationMs = Math.round(performance.now() - startedAt);
        const retrievedAt = new Date(now()).toISOString();
        options.logger.log({ event: "metro_fetch_complete", requestId: options.requestId, feed, status: response.status, bytes: data.byteLength, durationMs });
        return {
          raw: { data, retrievedAt, contentType, durationMs },
          parsed: { data: parsed, retrievedAt, contentType, durationMs },
          etag: response.headers.get("etag"),
          expiresAt: now() + cacheTtlMs,
        };
      }
      throw new MetroError("rate_limited", "METRO returned an unsuccessful response.");
    } finally {
      clearTimeout(timeout);
    }
  }

  function getFeed(feed: MetroFeedAlias): Promise<FeedPayload> {
    const cached = cache.get(feed);
    if (cached && now() < cached.expiresAt) return Promise.resolve(cached);
    const pending = inFlight.get(feed);
    if (pending) return pending;
    const request = fetchFeed(feed, cached).then((result) => {
      cache.set(feed, result);
      return result;
    }).finally(() => { inFlight.delete(feed); });
    inFlight.set(feed, request);
    return request;
  }

  return {
    getAlertsJson: async () => (await getFeed("alerts")).parsed,
    getAlertRoutesJson: async () => (await getFeed("alertRoutes")).parsed,
    getTripUpdatesBytes: async () => (await getFeed("tripUpdates")).raw,
    getTripUpdatesFeed: async () => (await getFeed("tripUpdates")).parsed as MetroFetchResult<FeedMessage>,
  };
}
