import { describe, it, expect } from "vitest";
import { parseWsCtx } from "./parse.js";

const msg = {
  channel: "activeAssetCtx",
  data: {
    coin: "BTC",
    ctx: {
      dayNtlVlm: "1000000.0",
      funding: "0.0000125",
      markPx: "65000.0",
      midPx: "65001.0",
      oraclePx: "64999.0",
      prevDayPx: "64000.0",
      openInterest: "120.0",
    },
  },
};

describe("parseWsCtx", () => {
  it("returns an AssetContext for an activeAssetCtx message", () => {
    expect(parseWsCtx(msg)).toEqual({
      name: "BTC",
      dayNtlVlm: 1_000_000,
      funding: 0.0000125,
      markPx: 65000,
      midPx: 65001,
      oraclePx: 64999,
      prevDayPx: 64000,
      openInterest: 120,
    });
  });

  it("returns null for non-ctx channels (e.g. pong)", () => {
    expect(parseWsCtx({ channel: "pong" })).toBeNull();
  });
});
