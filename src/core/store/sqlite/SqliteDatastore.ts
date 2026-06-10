import Database from "better-sqlite3";
import type { Database as DB } from "better-sqlite3";
import type { Datastore, MarketSnapshot, RunnerState, Trade } from "../Datastore.js";
import type { EquityPoint, AccountState, Fill } from "../../paper/index.js";
import type { CoinScore } from "../../signal/index.js";
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

  saveEquityPoint(point: EquityPoint): void {
    this.db
      .prepare("INSERT OR REPLACE INTO equity_points (timestamp, payload) VALUES (?, ?)")
      .run(point.timestamp, JSON.stringify(point));
  }

  getEquityCurve(): EquityPoint[] {
    const rows = this.db
      .prepare("SELECT payload FROM equity_points ORDER BY timestamp ASC")
      .all() as { payload: string }[];
    return rows.map((r) => JSON.parse(r.payload) as EquityPoint);
  }

  saveAccountState(state: AccountState): void {
    this.db
      .prepare("INSERT OR REPLACE INTO account_state (id, payload) VALUES (1, ?)")
      .run(JSON.stringify(state));
  }

  getAccountState(): AccountState | null {
    const row = this.db.prepare("SELECT payload FROM account_state WHERE id = 1").get() as
      | { payload: string }
      | undefined;
    return row ? (JSON.parse(row.payload) as AccountState) : null;
  }

  saveRunnerState(state: RunnerState): void {
    this.db
      .prepare("INSERT OR REPLACE INTO runner_state (id, payload) VALUES (1, ?)")
      .run(JSON.stringify(state));
  }

  getRunnerState(): RunnerState | null {
    const row = this.db.prepare("SELECT payload FROM runner_state WHERE id = 1").get() as
      | { payload: string }
      | undefined;
    return row ? (JSON.parse(row.payload) as RunnerState) : null;
  }

  saveSignal(capturedAt: number, scores: CoinScore[]): void {
    this.db
      .prepare("INSERT OR REPLACE INTO signals (captured_at, payload) VALUES (?, ?)")
      .run(capturedAt, JSON.stringify(scores));
  }

  getLatestSignal(): { capturedAt: number; scores: CoinScore[] } | null {
    const row = this.db
      .prepare("SELECT captured_at, payload FROM signals ORDER BY captured_at DESC LIMIT 1")
      .get() as { captured_at: number; payload: string } | undefined;
    if (!row) return null;
    return { capturedAt: row.captured_at, scores: JSON.parse(row.payload) as CoinScore[] };
  }

  saveTrades(timestamp: number, fills: Fill[]): void {
    const stmt = this.db.prepare("INSERT INTO trades (timestamp, payload) VALUES (?, ?)");
    for (const fill of fills) stmt.run(timestamp, JSON.stringify(fill));
  }

  getRecentTrades(limit: number): Trade[] {
    const rows = this.db
      .prepare("SELECT timestamp, payload FROM trades ORDER BY id DESC LIMIT ?")
      .all(limit) as { timestamp: number; payload: string }[];
    return rows.map((r) => ({ timestamp: r.timestamp, ...(JSON.parse(r.payload) as Fill) }));
  }

  transaction(fn: () => void): void {
    this.db.transaction(fn)();
  }

  close(): void {
    this.db.close();
  }
}
