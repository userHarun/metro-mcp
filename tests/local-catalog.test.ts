import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
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

function fixtureArchive(version = "fixture-v1"): Uint8Array {
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
    "feed_info.txt": strToU8(`feed_version,feed_start_date,feed_end_date\n${version},20260801,20261231\n`),
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

  it("repairs a corrupt fresh cache and validates a download before replacing a usable cache", async () => {
    const directory = await mkdtemp(join(tmpdir(), "metro-local-"));
    temporaryDirectories.push(directory);
    const archivePath = join(directory, "static-gtfs.zip");
    await writeFile(archivePath, "truncated zip");
    const download = vi.fn(async () => new Response(fixtureArchive()));
    const catalog = new LocalGtfsCatalog({ archivePath, fetcher: download, logger: silentLogger });
    await expect(catalog.getInfo()).resolves.toMatchObject({ source: { datasetVersion: "fixture-v1" } });
    expect(download).toHaveBeenCalledTimes(1);
    const goodBytes = await readFile(archivePath);

    await utimes(archivePath, new Date(0), new Date(0));
    const badRefresh = new LocalGtfsCatalog({ archivePath, fetcher: async () => new Response("bad zip"), logger: silentLogger });
    await expect(badRefresh.getInfo()).resolves.toMatchObject({ source: { datasetVersion: "fixture-v1" } });
    expect(await readFile(archivePath)).toEqual(goodBytes);
  });

  it("refreshes a long-lived catalog once and swaps the state after validation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "metro-local-"));
    temporaryDirectories.push(directory);
    let now = Date.now();
    const download = vi.fn()
      .mockResolvedValueOnce(new Response(fixtureArchive("fixture-v1")))
      .mockResolvedValueOnce(new Response(fixtureArchive("fixture-v2")));
    const catalog = new LocalGtfsCatalog({
      archivePath: join(directory, "static-gtfs.zip"), fetcher: download, logger: silentLogger,
      refreshIntervalMs: 1_000, now: () => now,
    });
    await expect(catalog.getInfo()).resolves.toMatchObject({ source: { datasetVersion: "fixture-v1" } });
    now += 1_001;
    const [first, second] = await Promise.all([catalog.getInfo(), catalog.getInfo()]);
    expect(first.source.datasetVersion).toBe("fixture-v1");
    expect(second.source.datasetVersion).toBe("fixture-v1");
    await vi.waitFor(async () => {
      expect((await catalog.getInfo()).source.datasetVersion).toBe("fixture-v2");
    });
    expect(download).toHaveBeenCalledTimes(2);
  });

  it("rejects an archive whose declared extracted size exceeds the limit", async () => {
    const directory = await mkdtemp(join(tmpdir(), "metro-local-"));
    temporaryDirectories.push(directory);
    const archive = fixtureArchive();
    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
    for (let index = 0; index < archive.byteLength - 4; index++) {
      if (view.getUint32(index, true) === 0x02014b50) {
        view.setUint32(index + 24, 97 * 1024 * 1024, true);
        break;
      }
    }
    const catalog = new LocalGtfsCatalog({ archivePath: join(directory, "static-gtfs.zip"), fetcher: async () => new Response(archive), logger: silentLogger });
    await expect(catalog.getInfo()).rejects.toMatchObject({ code: "invalid_response" });
  });
});
