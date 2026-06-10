import { describe, it, expect } from "vitest";
import { handleDashboardRequest } from "./handler.js";
import { SqliteDatastore } from "../core/store/index.js";

function store() {
  const s = new SqliteDatastore(":memory:");
  s.init();
  s.saveEquityPoint({ timestamp: 0, equity: 100_000, pricePnl: 0, fundingPnl: 0, fees: 0 });
  return s;
}

describe("handleDashboardRequest", () => {
  it("serves the dashboard state as JSON at /api/state", () => {
    const s = store();
    const res = handleDashboardRequest(s, "/api/state");
    expect(res.status).toBe(200);
    expect(res.contentType).toBe("application/json");
    const body = JSON.parse(res.body);
    expect(body.latestEquity).toBe(100_000);
    s.close();
  });

  it("serves the HTML page at /", () => {
    const s = store();
    const res = handleDashboardRequest(s, "/");
    expect(res.status).toBe(200);
    expect(res.contentType).toBe("text/html");
    expect(res.body).toContain("<!doctype html>");
    expect(res.body).toContain("/api/state");
    s.close();
  });

  it("404s unknown paths", () => {
    const s = store();
    const res = handleDashboardRequest(s, "/nope");
    expect(res.status).toBe(404);
    s.close();
  });

  it("includes live data in /api/state when a live provider is given", () => {
    const s = store();
    const live = () => ({ asOf: 123, feed: "connected", equity: 99_000, positions: [{ coin: "BTC", side: "long" as const, size: 1, entryPrice: 100, mark: 110, unrealizedPnl: 10 }] });
    const body = JSON.parse(handleDashboardRequest(s, "/api/state", { live }).body);
    expect(body.live.equity).toBe(99_000);
    expect(body.live.positions[0].unrealizedPnl).toBe(10);
    s.close();
  });

  it("requires HTTP basic auth when configured", () => {
    const s = store();
    const auth = { user: "u", pass: "p" };
    const no = handleDashboardRequest(s, "/", { auth });
    expect(no.status).toBe(401);
    expect(no.headers?.["www-authenticate"]).toContain("Basic");
    const ok = handleDashboardRequest(s, "/", { auth, authHeader: "Basic " + Buffer.from("u:p").toString("base64") });
    expect(ok.status).toBe(200);
    s.close();
  });
});
