import { addSavedRoute, loadSavedRoutes, removeSavedRoute, savedRoutesKey } from "../apps/web/src/saved-routes";
import type { Route } from "../apps/web/src/api";
import { describe, expect, it } from "vitest";

function route(routeId: string): Route {
  return { routeId, shortName: routeId, longName: `Route ${routeId}`, description: null, routeType: 3, color: null, textColor: null };
}

describe("saved route choices", () => {
  it("loads only valid saved routes and handles unavailable storage", () => {
    expect(loadSavedRoutes({ getItem: () => JSON.stringify([route("082")]) })).toEqual([route("082")]);
    expect(loadSavedRoutes({ getItem: () => "not-json" })).toEqual([]);
    expect(loadSavedRoutes({ getItem: () => JSON.stringify([{ routeId: "900" }]) })).toEqual([]);
    expect(loadSavedRoutes({ getItem: () => { throw new Error("blocked"); } })).toEqual([]);
  });

  it("keeps unique routes, caps the list, and removes a saved route", () => {
    const first = addSavedRoute([], route("082"));
    expect(addSavedRoute(first, route("082"))).toEqual(first);
    const saved = ["001", "002", "003", "004", "005", "006"].reduce<Route[]>((items, id) => addSavedRoute(items, route(id)), []);
    expect(saved.map((item) => item.routeId)).toEqual(["002", "003", "004", "005", "006"]);
    expect(removeSavedRoute(saved, "004").map((item) => item.routeId)).toEqual(["002", "003", "005", "006"]);
    expect(savedRoutesKey).toBe("metro-saved-routes");
  });
});
