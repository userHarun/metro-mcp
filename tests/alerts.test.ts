import { getNormalizedAlerts, type MetroLiveClient } from "@metro/core";
import { describe, expect, it } from "vitest";

describe("service alert normalization", () => {
  it("excludes alerts outside their active periods", async () => {
    const nowSeconds = 1_800_000_000;
    const alert = (id: number, start: number, end: number) => ({
      alert_id: id,
      effect_periods: [{ effect_start: String(start), effect_end: String(end) }],
      affected_services: { services: [{ route_id: "40401", route_name: "WESTHEIMER" }] },
    });
    const client: MetroLiveClient = {
      getAlertsJson: () => Promise.resolve({
        data: { alerts: [
          alert(1, nowSeconds - 60, nowSeconds + 60),
          alert(2, nowSeconds + 60, nowSeconds + 120),
          alert(3, nowSeconds - 120, nowSeconds - 60),
        ] },
        retrievedAt: new Date(nowSeconds * 1_000).toISOString(), contentType: "application/json", durationMs: 1,
      }),
      getAlertRoutesJson: () => Promise.reject(new Error("unused")),
      getTripUpdatesBytes: () => Promise.reject(new Error("unused")),
    };
    const result = await getNormalizedAlerts(client, { routeId: "082", routeName: "Westheimer", nowMs: nowSeconds * 1_000 });
    expect(result.alerts.map((item) => item.id)).toEqual(["1"]);
  });
});
