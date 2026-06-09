import { WebSocket } from "ws";
import type { MarketDataSource } from "../MarketDataSource.js";
import type { AssetContext, Candle, FundingPoint, WatchHandlers, WatchHandle, WatchStatus } from "../types.js";
import { postInfo, type FetchFn } from "./http.js";
import { parseUniverse, parseCandles, parseFunding, parseWsCtx } from "./parse.js";
import { ReconnectingWs, type SocketFactory, type SocketLike } from "./ws.js";

const ONE_DAY_MS = 86_400_000;

export interface HyperLiquidConfig {
  baseUrl?: string;
  wsUrl?: string;
  fetchFn?: FetchFn;
  /** Inject a socket factory for tests; defaults to a real `ws` adapter. */
  wsFactory?: SocketFactory;
  /** Injectable clock for `getDailyCandles` window math; defaults to Date.now. */
  now?: () => number;
}

export class HyperLiquidDataSource implements MarketDataSource {
  private readonly baseUrl: string;
  private readonly wsUrl: string;
  private readonly fetchFn: FetchFn;
  private readonly wsFactory: SocketFactory;
  private readonly now: () => number;

  constructor(cfg: HyperLiquidConfig = {}) {
    this.baseUrl = cfg.baseUrl ?? "https://api.hyperliquid.xyz";
    this.wsUrl = cfg.wsUrl ?? "wss://api.hyperliquid.xyz/ws";
    this.fetchFn = cfg.fetchFn ?? fetch;
    this.wsFactory = cfg.wsFactory ?? defaultWsFactory;
    this.now = cfg.now ?? Date.now;
  }

  async getUniverse(topN: number): Promise<AssetContext[]> {
    const raw = await postInfo({ baseUrl: this.baseUrl, fetchFn: this.fetchFn }, { type: "metaAndAssetCtxs" });
    return parseUniverse(raw, topN);
  }

  async getDailyCandles(coin: string, days: number): Promise<Candle[]> {
    const endTime = this.now();
    const startTime = endTime - days * ONE_DAY_MS;
    const raw = await postInfo(
      { baseUrl: this.baseUrl, fetchFn: this.fetchFn },
      { type: "candleSnapshot", req: { coin, interval: "1d", startTime, endTime } },
    );
    return parseCandles(raw);
  }

  async getFundingHistory(coin: string, sinceMs: number): Promise<FundingPoint[]> {
    const raw = await postInfo(
      { baseUrl: this.baseUrl, fetchFn: this.fetchFn },
      { type: "fundingHistory", coin, startTime: sinceMs },
    );
    return parseFunding(raw);
  }

  watch(coins: string[], handlers: WatchHandlers): WatchHandle {
    let status: WatchStatus = "connecting";
    const conn = new ReconnectingWs({
      url: this.wsUrl,
      coins,
      factory: this.wsFactory,
      onStatus: (s) => { status = s; handlers.onStatus?.(s); },
      onError: (e) => handlers.onError?.(e),
      onMessage: (msg) => {
        const ctx = parseWsCtx(msg);
        if (ctx) handlers.onCtx(ctx);
      },
    });
    conn.start();
    return { status: () => status, close: () => conn.stop() };
  }
}

/** Adapt the `ws` package's WebSocket to our `SocketLike` shape. */
function defaultWsFactory(url: string): SocketLike {
  const raw = new WebSocket(url);
  const sock: SocketLike = {
    send: (d) => raw.send(d),
    close: () => raw.close(),
    onopen: null, onmessage: null, onclose: null, onerror: null,
  };
  raw.on("open", () => sock.onopen?.());
  raw.on("message", (d: Buffer) => sock.onmessage?.(d.toString()));
  raw.on("close", () => sock.onclose?.());
  raw.on("error", (e: Error) => sock.onerror?.(e));
  return sock;
}
