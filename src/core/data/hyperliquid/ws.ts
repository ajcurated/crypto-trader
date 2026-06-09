export interface SocketLike {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((data: string) => void) | null;
  onclose: (() => void) | null;
  onerror: ((err: Error) => void) | null;
}

export type SocketFactory = (url: string) => SocketLike;

export interface ReconnectingWsOptions {
  url: string;
  coins: string[];
  factory: SocketFactory;
  onMessage?: (msg: unknown) => void;
  onStatus?: (status: "connecting" | "connected" | "reconnecting" | "closed") => void;
  onError?: (err: Error) => void;
  /** Injectable timer for deterministic tests (defaults to setTimeout). */
  schedule?: (fn: () => void, ms: number) => void;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
}

/**
 * A WebSocket wrapper that re-subscribes on every connect and reconnects with
 * exponential backoff (capped). Socket and timer are injectable for testing.
 */
export class ReconnectingWs {
  private readonly o: Required<
    Pick<ReconnectingWsOptions, "url" | "coins" | "factory" | "schedule" | "baseBackoffMs" | "maxBackoffMs">
  > &
    ReconnectingWsOptions;
  private sock: SocketLike | null = null;
  private attempt = 0;
  private stopped = false;

  constructor(opts: ReconnectingWsOptions) {
    this.o = {
      schedule: (fn, ms) => void setTimeout(fn, ms),
      baseBackoffMs: 1000,
      maxBackoffMs: 30_000,
      ...opts,
    };
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.o.onStatus?.("closed");
    this.sock?.close();
    this.sock = null;
  }

  private connect(): void {
    this.o.onStatus?.(this.attempt === 0 ? "connecting" : "reconnecting");
    const s = this.o.factory(this.o.url);
    this.sock = s;

    s.onopen = () => {
      // Reset backoff on a successful open: a cleanly-established connection that
      // later drops should recover fast (1s), which is what a risk feed wants.
      // Trade-off: a connection that opens then immediately drops retries at the
      // 1s floor rather than escalating. Acceptable for v1 — the floor prevents a
      // busy loop, and full exponential escalation still applies while we can't
      // even establish a connection (see scheduleReconnect).
      this.attempt = 0;
      this.o.onStatus?.("connected");
      for (const coin of this.o.coins) {
        s.send(JSON.stringify({ method: "subscribe", subscription: { type: "activeAssetCtx", coin } }));
      }
    };
    s.onmessage = (data) => {
      try {
        this.o.onMessage?.(JSON.parse(data));
      } catch (err) {
        this.o.onError?.(err as Error);
      }
    };
    s.onerror = (err) => this.o.onError?.(err);
    s.onclose = () => {
      // Ignore a close from a socket we've already replaced or stopped, so a
      // stale handler can never schedule a spurious second reconnect.
      if (this.stopped || this.sock !== s) return;
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    const delay = Math.min(this.o.baseBackoffMs * 2 ** this.attempt, this.o.maxBackoffMs);
    this.attempt += 1;
    this.o.schedule(() => {
      if (!this.stopped) this.connect();
    }, delay);
  }
}
