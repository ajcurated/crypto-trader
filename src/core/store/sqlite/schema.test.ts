import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "./schema.js";

describe("migrate", () => {
  it("creates the market_snapshots table and is idempotent", () => {
    const db = new Database(":memory:");
    migrate(db);
    migrate(db); // second run must not throw

    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='market_snapshots'")
      .get() as { name: string } | undefined;
    expect(row?.name).toBe("market_snapshots");
    db.close();
  });
});
