import type { Database } from "better-sqlite3";

/** Create all tables if they do not exist. Idempotent. */
export function migrate(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS market_snapshots (
      captured_at INTEGER PRIMARY KEY,
      payload     TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS equity_points (
      timestamp   INTEGER PRIMARY KEY,
      payload     TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS account_state (
      id      INTEGER PRIMARY KEY CHECK (id = 1),
      payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS runner_state (
      id      INTEGER PRIMARY KEY CHECK (id = 1),
      payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS signals (
      captured_at INTEGER PRIMARY KEY,
      payload     TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS trades (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      payload   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_trades_ts ON trades (timestamp);
  `);
}
