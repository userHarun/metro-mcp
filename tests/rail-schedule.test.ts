import { gtfsTimeToIso, nextScheduledRailArrivals, type RailStopTime, type ServiceCalendar } from "@metro/core";
import { describe, expect, it } from "vitest";

const weekday: ServiceCalendar = { serviceId: "weekday", startDate: "20260830", endDate: "20270123", weekdays: [false, true, true, true, true, true, false] };
const row = (serviceId: string, departureSeconds: number): RailStopTime => ({ routeId: "900", serviceId, tripId: `${serviceId}-${departureSeconds}`, stopId: "25051", departureSeconds, headsign: "Palm Center" });

describe("rail schedule", () => {
  it("converts Houston service times to UTC in daylight and standard time", () => {
    expect(gtfsTimeToIso("20260928", 14 * 3600)).toBe("2026-09-28T19:00:00.000Z");
    expect(gtfsTimeToIso("20260105", 14 * 3600)).toBe("2026-01-05T20:00:00.000Z");
    expect(gtfsTimeToIso("20260928", 25 * 3600 + 15 * 60)).toBe("2026-09-29T06:15:00.000Z");
  });

  it("orders active departures and applies service exceptions", () => {
    const nowMs = Date.parse("2026-09-28T19:00:00.000Z");
    const rows = [row("weekday", 14 * 3600 + 24 * 60), row("weekday", 14 * 3600 + 12 * 60), row("holiday", 14 * 3600 + 6 * 60)];
    expect(nextScheduledRailArrivals(rows, [weekday], [], nowMs, 2).map((item) => item.scheduledAt)).toEqual([
      "2026-09-28T19:12:00.000Z", "2026-09-28T19:24:00.000Z",
    ]);
    expect(nextScheduledRailArrivals(rows, [weekday], [
      { serviceId: "weekday", date: "20260928", type: 2 },
      { serviceId: "holiday", date: "20260928", type: 1 },
    ], nowMs, 2).map((item) => item.scheduledAt)).toEqual(["2026-09-28T19:06:00.000Z"]);
  });
});
