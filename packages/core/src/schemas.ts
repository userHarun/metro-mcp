import { z } from "zod";

export const providerSchema = z.literal("Houston METRO");

export const sourceMetadataSchema = z.object({
  provider: providerSchema,
  feed: z.enum(["static-gtfs", "gtfs-realtime-trip-updates", "v2-alerts-json"]),
  retrievedAt: z.string().datetime(),
  feedTimestamp: z.string().datetime().nullable().optional(),
  ageSeconds: z.number().int().nonnegative().nullable().optional(),
  isStale: z.boolean().nullable().optional(),
  datasetVersion: z.string().nullable().optional(),
  serviceStartDate: z.string().nullable().optional(),
  serviceEndDate: z.string().nullable().optional(),
});

export const routeSchema = z.object({
  routeId: z.string(),
  shortName: z.string().nullable(),
  longName: z.string().nullable(),
  description: z.string().nullable(),
  routeType: z.number().int(),
  color: z.string().nullable(),
  textColor: z.string().nullable(),
});

export const stopSchema = z.object({
  stopId: z.string(),
  stopCode: z.string().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  locationType: z.number().int().nullable(),
  parentStation: z.string().nullable(),
  wheelchairBoarding: z.number().int().nullable(),
});

export const nearbyStopSchema = stopSchema.extend({
  distanceMeters: z.number().int().nonnegative(),
});

export const arrivalSchema = z.object({
  tripId: z.string().nullable(),
  routeId: z.string().nullable(),
  stopId: z.string(),
  stopSequence: z.number().int().nullable(),
  predictedAt: z.string().datetime(),
  eventType: z.enum(["arrival", "departure"]),
  delaySeconds: z.number().int().nullable(),
  tripUpdatedAt: z.string().datetime().nullable(),
});

export const scheduledArrivalSchema = z.object({
  tripId: z.string(),
  routeId: z.string(),
  stopId: z.string(),
  scheduledAt: z.string().datetime(),
  headsign: z.string().nullable(),
});

export const serviceAlertSchema = z.object({
  id: z.string(),
  title: z.string(),
  shortTitle: z.string().nullable(),
  description: z.string().nullable(),
  effect: z.string().nullable(),
  severity: z.string().nullable(),
  lifecycle: z.string().nullable(),
  createdAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime().nullable(),
  activePeriods: z.array(z.object({
    startsAt: z.string().datetime().nullable(),
    endsAt: z.string().datetime().nullable(),
  })),
  affectedRoutes: z.array(z.object({
    routeId: z.string(),
    routeName: z.string().nullable(),
    mode: z.string().nullable(),
  })),
});

export const routeSearchResultSchema = z.object({
  query: z.string(),
  routes: z.array(routeSchema),
  source: sourceMetadataSchema,
});

export const stopSearchResultSchema = z.object({
  query: z.string(),
  stops: z.array(stopSchema),
  source: sourceMetadataSchema,
});

export const nearbyStopsResultSchema = z.object({
  location: z.object({ latitude: z.number(), longitude: z.number() }),
  stops: z.array(nearbyStopSchema),
  source: sourceMetadataSchema,
});

export const arrivalsResultSchema = z.object({
  stopId: z.string(),
  arrivals: z.array(arrivalSchema),
  coverage: z.object({
    routeTripUpdates: z.boolean().nullable(),
    stopTimeUpdates: z.boolean().nullable(),
  }),
  schedule: z.object({ arrivals: z.array(scheduledArrivalSchema), source: sourceMetadataSchema }).nullable(),
  source: sourceMetadataSchema,
});

export const alertsResultSchema = z.object({
  alerts: z.array(serviceAlertSchema),
  source: sourceMetadataSchema,
});

export const dataSourcesResultSchema = z.object({
  sources: z.array(z.object({
    name: z.string(),
    status: z.enum(["configured", "missing", "not_ready"]),
    detail: z.string(),
  })),
  attribution: z.string(),
  trademark: z.string(),
});

export type SourceMetadata = z.infer<typeof sourceMetadataSchema>;
export type TransitRoute = z.infer<typeof routeSchema>;
export type TransitStop = z.infer<typeof stopSchema>;
export type NearbyStop = z.infer<typeof nearbyStopSchema>;
export type Arrival = z.infer<typeof arrivalSchema>;
export type ScheduledArrival = z.infer<typeof scheduledArrivalSchema>;
export type RailScheduleResult = NonNullable<z.infer<typeof arrivalsResultSchema>["schedule"]>;
export type ServiceAlert = z.infer<typeof serviceAlertSchema>;
export type RouteSearchResult = z.infer<typeof routeSearchResultSchema>;
export type StopSearchResult = z.infer<typeof stopSearchResultSchema>;
export type NearbyStopsResult = z.infer<typeof nearbyStopsResultSchema>;
export type ArrivalsResult = z.infer<typeof arrivalsResultSchema>;
export type AlertsResult = z.infer<typeof alertsResultSchema>;
export type DataSourcesResult = z.infer<typeof dataSourcesResultSchema>;
