import { z } from "zod";
import { MetroError } from "./errors.js";
import type { MetroLiveClient } from "./metro-client.js";
import type { AlertsResult, ServiceAlert } from "./schemas.js";

const identifierSchema = z.union([z.string(), z.number()]);
const epochSchema = z.union([z.string(), z.number()]).nullable().optional();
const metroAlertSchema = z.object({
  alert_id: identifierSchema,
  effect_name: z.string().nullable().optional(),
  effect: z.string().nullable().optional(),
  header_text: z.string().nullable().optional(),
  short_header_text: z.string().nullable().optional(),
  description_text: z.string().nullable().optional(),
  service_effect_text: z.string().nullable().optional(),
  severity: z.string().nullable().optional(),
  alert_lifecycle: z.string().nullable().optional(),
  created_dt: epochSchema,
  last_modified_dt: epochSchema,
  effect_periods: z.array(z.object({
    effect_start: epochSchema,
    effect_end: epochSchema,
  }).passthrough()).default([]),
  affected_services: z.object({
    services: z.array(z.object({
      route_id: identifierSchema,
      route_name: z.string().nullable().optional(),
      mode_name: z.string().nullable().optional(),
    }).passthrough()).default([]),
  }).passthrough().default({ services: [] }),
}).passthrough();

const responseSchema = z.object({ alerts: z.array(metroAlertSchema) }).passthrough();
type MetroAlert = z.infer<typeof metroAlertSchema>;

function epochToIso(value: string | number | null | undefined): string | null {
  if (value == null || value === "") return null;
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return null;
  const date = new Date(seconds * 1_000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeAlert(alert: MetroAlert): ServiceAlert {
  return {
    id: String(alert.alert_id),
    title: alert.header_text ?? alert.short_header_text ?? "METRO service alert",
    shortTitle: alert.short_header_text ?? null,
    description: alert.description_text ?? alert.service_effect_text ?? null,
    effect: alert.effect_name ?? alert.effect ?? null,
    severity: alert.severity ?? null,
    lifecycle: alert.alert_lifecycle ?? null,
    createdAt: epochToIso(alert.created_dt),
    updatedAt: epochToIso(alert.last_modified_dt),
    activePeriods: alert.effect_periods.map((period) => ({
      startsAt: epochToIso(period.effect_start),
      endsAt: epochToIso(period.effect_end),
    })),
    affectedRoutes: alert.affected_services.services.map((route) => ({
      routeId: String(route.route_id),
      routeName: route.route_name ?? null,
      mode: route.mode_name ?? null,
    })),
  };
}

export async function getNormalizedAlerts(client: MetroLiveClient, routeId?: string): Promise<AlertsResult> {
  const response = await client.getAlertsJson();
  const parsed = responseSchema.safeParse(response.data);
  if (!parsed.success) {
    throw new MetroError("invalid_response", "METRO returned an invalid alerts payload.");
  }
  const alerts = parsed.data.alerts
    .map(normalizeAlert)
    .filter((alert) => !routeId || alert.affectedRoutes.some((route) => route.routeId === routeId))
    .sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""));
  return {
    alerts,
    source: {
      provider: "Houston METRO",
      feed: "v2-alerts-json",
      retrievedAt: response.retrievedAt,
    },
  };
}
