import { describe, it, expect } from "vitest";
import { evaluateRisk, type RiskParams } from "./evaluate.js";
import type { Position } from "../paper/index.js";

const PARAMS: RiskParams = { spreadStopPct: 0.08, circuitBreakerBand: 0.15, fundingAlertAnnualized: 0.5 };
const m = (o: Record<string, number>) => new Map(Object.entries(o));

const longBTC: Position = { coin: "BTC", side: "long", size: 10, entryPrice: 100 };
const shortETH: Position = { coin: "ETH", side: "short", size: 20, entryPrice: 50 };

describe("evaluateRisk", () => {
  it("does nothing when the book is healthy", () => {
    const r = evaluateRisk([longBTC, shortETH], m({ BTC: 101, ETH: 49 }), m({ BTC: 0, ETH: 0 }), 10_000, PARAMS);
    expect(r).toEqual({ flattenAll: false, flattenLegs: [], alerts: [] });
  });

  it("flattens the whole book when total unrealized loss exceeds the spread stop", () => {
    const r = evaluateRisk([longBTC, shortETH], m({ BTC: 95, ETH: 53 }), m({ BTC: 0, ETH: 0 }), 1_000, PARAMS);
    expect(r.flattenAll).toBe(true);
  });

  it("flattens a single leg that gaps beyond the circuit-breaker band", () => {
    const r = evaluateRisk([longBTC, shortETH], m({ BTC: 80, ETH: 50 }), m({ BTC: 0, ETH: 0 }), 1_000_000, PARAMS);
    expect(r.flattenAll).toBe(false);
    expect(r.flattenLegs).toEqual(["BTC"]);
  });

  it("alerts on an annualized funding spike without flattening", () => {
    const r = evaluateRisk([longBTC], m({ BTC: 100 }), m({ BTC: 0.0001 }), 1_000_000, PARAMS);
    expect(r.flattenAll).toBe(false);
    expect(r.flattenLegs).toEqual([]);
    expect(r.alerts.some((a) => a.includes("BTC") && a.toLowerCase().includes("funding"))).toBe(true);
  });

  it("ignores legs with no current mark", () => {
    const r = evaluateRisk([longBTC], m({}), m({}), 1_000, PARAMS);
    expect(r).toEqual({ flattenAll: false, flattenLegs: [], alerts: [] });
  });
});
