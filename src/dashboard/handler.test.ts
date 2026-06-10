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
});
