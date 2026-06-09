import { describe, it, expect } from "vitest";
import { parseFunding } from "./parse.js";
import raw from "../__fixtures__/fundingHistory.json" with { type: "json" };

describe("parseFunding", () => {
  it("maps to FundingPoint, preserving order and sign", () => {
    const out = parseFunding(raw as unknown);
    expect(out).toEqual([
      { coin: "BTC", rate: 0.0000125, time: 1717200000000 },
      { coin: "BTC", rate: -0.000003, time: 1717203600000 },
    ]);
  });
});
