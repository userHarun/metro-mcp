import { z } from "zod";

export const stopSchema = z.object({
  stopId: z.string(), stopCode: z.string().nullable(), name: z.string(), description: z.string().nullable(),
  latitude: z.number(), longitude: z.number(), locationType: z.number().nullable(), parentStation: z.string().nullable(), wheelchairBoarding: z.number().nullable(),
});
export const routeSchema = z.object({
  routeId: z.string(), shortName: z.string().nullable(), longName: z.string().nullable(), description: z.string().nullable(),
  routeType: z.number(), color: z.string().nullable(), textColor: z.string().nullable(),
});
export const arrivalSchema = z.object({
  tripId: z.string().nullable(), routeId: z.string().nullable(), stopId: z.string(), stopSequence: z.number().nullable(),
  predictedAt: z.string(), eventType: z.enum(["arrival", "departure"]), delaySeconds: z.number().nullable(), tripUpdatedAt: z.string().nullable(),
});

const stopSearchSchema = z.object({ stops: z.array(stopSchema) });
const routeSearchSchema = z.object({ routes: z.array(routeSchema) });
const arrivalsSchema = z.object({
  stopId: z.string(), arrivals: z.array(arrivalSchema), source: z.object({
    retrievedAt: z.string(), feedTimestamp: z.string().nullable().optional(), isStale: z.boolean().nullable().optional(),
  }).passthrough(),
});
const configSchema = z.object({ githubUrl: z.string().url().nullable() });
const errorSchema = z.object({ message: z.string() }).passthrough();

export type Stop = z.infer<typeof stopSchema>;
export type Route = z.infer<typeof routeSchema>;
export type Arrival = z.infer<typeof arrivalSchema>;
export type ArrivalsResponse = z.infer<typeof arrivalsSchema>;

async function get<T>(path: string, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
  const init: RequestInit = { headers: { Accept: "application/json" } };
  if (signal) init.signal = signal;
  const response = await fetch(path, init);
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = errorSchema.safeParse(payload);
    throw new Error(parsed.success ? parsed.data.message : "The transit request failed.");
  }
  return schema.parse(payload);
}

export async function searchStops(query: string, signal?: AbortSignal): Promise<Stop[]> {
  return (await get(`/api/stops/search?q=${encodeURIComponent(query)}&limit=6`, stopSearchSchema, signal)).stops;
}

export async function searchRoutes(query: string, signal?: AbortSignal): Promise<Route[]> {
  return (await get(`/api/routes/search?q=${encodeURIComponent(query)}&limit=6`, routeSearchSchema, signal)).routes;
}

export function getArrivals(stopId: string, routeId?: string, signal?: AbortSignal): Promise<ArrivalsResponse> {
  const params = new URLSearchParams({ stopId, limit: "6" });
  if (routeId) params.set("routeId", routeId);
  return get(`/api/arrivals?${params}`, arrivalsSchema, signal);
}

export function getConfig(): Promise<z.infer<typeof configSchema>> {
  return get("/api/config", configSchema);
}
