import { describe, expect, it } from "vitest";
import { cacheScanAssets, needsConnection, scanAssetsStatus } from "./offline";

describe("needsConnection", () => {
  it("never blocks a scan while online", () => {
    expect(needsConnection(true, "ready")).toBe(false);
    expect(needsConnection(true, "missing")).toBe(false);
    expect(needsConnection(true, "unknown")).toBe(false);
  });

  it("blocks an offline scan unless every asset is cached", () => {
    expect(needsConnection(false, "ready")).toBe(false);
    expect(needsConnection(false, "missing")).toBe(true);
    expect(needsConnection(false, "unknown")).toBe(true);
  });
});

describe("asset status without a service worker", () => {
  it("is unknown", async () => {
    expect(await scanAssetsStatus()).toBe("unknown");
    expect(await cacheScanAssets()).toBe("unknown");
  });
});
