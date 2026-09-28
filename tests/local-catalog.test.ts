import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { silentLogger } from "@metro/core";
import { LocalGtfsCatalog } from "@metro/local";
import { strToU8, zipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function fixtureArchive(): Uint8Array {
  return zipSync({
    "routes.txt": strToU8([
      "route_id,route_short_name,route_long_name,route_type,route_color,route_text_color",
      "route-82,082,Westheimer,3,D94136,FFFFFF",
      "route-25,25,Richmond,3,00853E,FFFFFF",
    ].join("\n")),
    "stops.txt": strToU8([
      "stop_id,stop_code,stop_name,stop_lat,stop_lon,location_type,wheelchair_boarding",
      "stop-1,1001,Westheimer at Main,29.7400,-95.3900,0,1",
      "stop-2,1002,Richmond at Main,29.7300,-95.3900,0,1",
    ].join("\n")),
    "feed_info.txt": strToU8("feed_version,feed_start_date,feed_end_date\nfixture-v1,20260801,20261231\n"),
  });
}

describe("local Static GTFS catalog", () => {
  it("downloads once, searches locally, and reuses the cached archive", async () => {
    const directory = await mkdtemp(join(tmpdir(), "metro-local-"));
    temporaryDirectories.push(directory);
    const archivePath = join(directory, "static-gtfs.zip");
    const download = vi.fn(async () => new Response(fixtureArchive(), { status: 200 }));
    const catalog = new LocalGtfsCatalog({ archivePath, fetcher: download, logger: silentLogger });

    await expect(catalog.searchRoutes({ query: "82", limit: 5 })).resolves.toMatchObject({
      routes: [{ routeId: "route-82", shortName: "082" }],
      source: { datasetVersion: "fixture-v1" },
    });
    await expect(catalog.searchStops({ query: "Westheimer Main", limit: 5 })).resolves.toMatchObject({
      stops: [{ stopId: "stop-1" }],
    });
    await expect(catalog.findNearbyStops({ latitude: 29.7401, longitude: -95.39, limit: 1 })).resolves.toMatchObject({
      stops: [{ stopId: "stop-1" }],
    });
    expect(download).toHaveBeenCalledTimes(1);

    const cachedCatalog = new LocalGtfsCatalog({
      archivePath,
      refreshIntervalMs: Number.POSITIVE_INFINITY,
      fetcher: async () => { throw new Error("network should not be used"); },
      logger: silentLogger,
    });
    await expect(cachedCatalog.getRoute("route-25")).resolves.toMatchObject({ longName: "Richmond" });
  });

  it("rejects an oversized Static GTFS download", async () => {
    const directory = await mkdtemp(join(tmpdir(), "metro-local-"));
    temporaryDirectories.push(directory);
    const catalog = new LocalGtfsCatalog({
      archivePath: join(directory, "static-gtfs.zip"),
      fetcher: async () => new Response("too large", { headers: { "Content-Length": String(33 * 1024 * 1024) } }),
      logger: silentLogger,
    });
    await expect(catalog.getInfo()).rejects.toMatchObject({ code: "invalid_response" });
  });
});
