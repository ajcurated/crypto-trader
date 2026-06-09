import type { Database } from "better-sqlite3";

/** Create all Phase 1 tables if they do not exist. Idempotent. */
export function migrate(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS market_snapshots (
      captured_at INTEGER PRIMARY KEY,
      payload     TEXT NOT NULL
    );
  `);
}
