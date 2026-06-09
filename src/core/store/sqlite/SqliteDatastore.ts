import Database from "better-sqlite3";
import type { Database as DB } from "better-sqlite3";
import type { Datastore, MarketSnapshot } from "../Datastore.js";
import { migrate } from "./schema.js";

export class SqliteDatastore implements Datastore {
  private readonly db: DB;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
  }

  init(): void {
    migrate(this.db);
  }

  saveMarketSnapshot(snapshot: MarketSnapshot): void {
    this.db
      .prepare("INSERT OR REPLACE INTO market_snapshots (captured_at, payload) VALUES (?, ?)")
      .run(snapshot.capturedAt, JSON.stringify(snapshot.universe));
  }

  getLatestSnapshot(): MarketSnapshot | null {
    const row = this.db
      .prepare("SELECT captured_at, payload FROM market_snapshots ORDER BY captured_at DESC LIMIT 1")
      .get() as { captured_at: number; payload: string } | undefined;
    if (!row) return null;
    return { capturedAt: row.captured_at, universe: JSON.parse(row.payload) };
  }

  close(): void {
    this.db.close();
  }
}
