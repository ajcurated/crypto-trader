import { describe, it, expect } from "vitest";
import { parseUniverse } from "./parse.js";
import raw from "../__fixtures__/metaAndAssetCtxs.json" with { type: "json" };

describe("parseUniverse", () => {
  it("zips universe with contexts and sorts desc by volume, capped at topN", () => {
    const out = parseUniverse(raw as unknown, 2);
    expect(out.map((c) => c.name)).toEqual(["ETH", "BTC"]);
    expect(out[0]).toMatchObject({ name: "ETH", dayNtlVlm: 3_000_000, funding: 0.00001 });
  });

  it("parses every field including a null midPx", () => {
    const all = parseUniverse(raw as unknown, 10);
    const sol = all.find((c) => c.name === "SOL")!;
    expect(sol).toEqual({
      name: "SOL",
      dayNtlVlm: 2_000_000,
      funding: -0.000005,
      markPx: 150,
      midPx: null,
      oraclePx: 149.5,
      prevDayPx: 145,
      openInterest: 5000,
    });
  });
});
