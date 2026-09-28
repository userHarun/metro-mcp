import type { ScheduledArrival } from "./schemas.js";

export interface RailStopTime {
  routeId: string;
  serviceId: string;
  tripId: string;
  stopId: string;
  departureSeconds: number;
  headsign: string | null;
}

export interface ServiceCalendar {
  serviceId: string;
  startDate: string;
  endDate: string;
  weekdays: readonly boolean[];
}

export interface ServiceException {
  serviceId: string;
  date: string;
  type: 1 | 2;
}

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
});
const offsetFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago", timeZoneName: "shortOffset",
});

function dateParts(date: Date): { year: number; month: number; day: number } {
  const parts = dateFormatter.formatToParts(date);
  const value = (name: string) => Number(parts.find((part) => part.type === name)?.value);
  return { year: value("year"), month: value("month"), day: value("day") };
}

function dateKey(ms: number): string {
  const { year, month, day } = dateParts(new Date(ms));
  return `${year}${String(month).padStart(2, "0")}${String(day).padStart(2, "0")}`;
}

function addDate(key: string, days: number): string {
  const utc = Date.UTC(Number(key.slice(0, 4)), Number(key.slice(4, 6)) - 1, Number(key.slice(6, 8)) + days);
  return new Date(utc).toISOString().slice(0, 10).replaceAll("-", "");
}

function offsetMinutes(ms: number): number {
  const label = offsetFormatter.formatToParts(new Date(ms)).find((part) => part.type === "timeZoneName")?.value ?? "GMT-6";
  const match = label.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/);
  if (!match) throw new Error("Houston time zone offset is unavailable.");
  const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0);
  return match[1] === "+" ? minutes : -minutes;
}

export function gtfsTimeToIso(serviceDate: string, seconds: number): string {
  const localMs = Date.UTC(Number(serviceDate.slice(0, 4)), Number(serviceDate.slice(4, 6)) - 1, Number(serviceDate.slice(6, 8))) + seconds * 1_000;
  let utcMs = localMs - offsetMinutes(localMs) * 60_000;
  utcMs = localMs - offsetMinutes(utcMs) * 60_000;
  return new Date(utcMs).toISOString();
}

function serviceRuns(calendar: ServiceCalendar | undefined, exceptions: Map<string, 1 | 2>, serviceId: string, key: string): boolean {
  const override = exceptions.get(`${serviceId}:${key}`);
  if (override) return override === 1;
  if (!calendar || key < calendar.startDate || key > calendar.endDate) return false;
  const weekday = new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(4, 6)) - 1, Number(key.slice(6, 8)))).getUTCDay();
  return Boolean(calendar.weekdays[weekday]);
}

export function nextScheduledRailArrivals(
  stopTimes: readonly RailStopTime[],
  calendars: readonly ServiceCalendar[],
  exceptions: readonly ServiceException[],
  nowMs: number,
  limit: number,
): ScheduledArrival[] {
  const today = dateKey(nowMs);
  const dates = [addDate(today, -1), today, addDate(today, 1)];
  const byService = new Map(calendars.map((calendar) => [calendar.serviceId, calendar]));
  const overrides = new Map(exceptions.map((exception) => [`${exception.serviceId}:${exception.date}`, exception.type]));
  const endMs = nowMs + 24 * 60 * 60 * 1_000;
  const arrivals: ScheduledArrival[] = [];
  for (const serviceDate of dates) {
    for (const row of stopTimes) {
      if (!serviceRuns(byService.get(row.serviceId), overrides, row.serviceId, serviceDate)) continue;
      const scheduledAt = gtfsTimeToIso(serviceDate, row.departureSeconds);
      const when = Date.parse(scheduledAt);
      if (when < nowMs - 60_000 || when > endMs) continue;
      arrivals.push({ tripId: row.tripId, routeId: row.routeId, stopId: row.stopId, scheduledAt, headsign: row.headsign });
    }
  }
  return arrivals.sort((left, right) => left.scheduledAt.localeCompare(right.scheduledAt)).slice(0, limit);
}
