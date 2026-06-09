import { describe, it, expect, vi } from "vitest";
import { ReconnectingWs } from "./ws.js";
import type { SocketLike, SocketFactory } from "./ws.js";

/** Minimal fake socket we can drive from tests. */
class FakeSocket implements SocketLike {
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((data: string) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((err: Error) => void) | null = null;
  closed = false;
  send(data: string) { this.sent.push(data); }
  close() { this.closed = true; this.onclose?.(); }
  fireOpen() { this.onopen?.(); }
  fireMessage(obj: unknown) { this.onmessage?.(JSON.stringify(obj)); }
  fireClose() { this.onclose?.(); }
}

function setup() {
  const sockets: FakeSocket[] = [];
  const factory: SocketFactory = () => {
    const s = new FakeSocket();
    sockets.push(s);
    return s;
  };
  return { sockets, factory };
}

describe("ReconnectingWs", () => {
  it("subscribes to all coins on open", () => {
    const { sockets, factory } = setup();
    const ws = new ReconnectingWs({ url: "ws://x", coins: ["BTC", "ETH"], factory });
    ws.start();
    sockets[0]!.fireOpen();

    expect(sockets[0]!.sent).toEqual([
      JSON.stringify({ method: "subscribe", subscription: { type: "activeAssetCtx", coin: "BTC" } }),
      JSON.stringify({ method: "subscribe", subscription: { type: "activeAssetCtx", coin: "ETH" } }),
    ]);
  });

  it("delivers parsed messages to onMessage", () => {
    const { sockets, factory } = setup();
    const seen: unknown[] = [];
    const ws = new ReconnectingWs({ url: "ws://x", coins: ["BTC"], factory, onMessage: (m) => seen.push(m) });
    ws.start();
    sockets[0]!.fireOpen();
    sockets[0]!.fireMessage({ channel: "activeAssetCtx", data: { coin: "BTC" } });

    expect(seen).toEqual([{ channel: "activeAssetCtx", data: { coin: "BTC" } }]);
  });

  it("reconnects with exponential backoff", () => {
    vi.useFakeTimers();
    const { sockets, factory } = setup();
    const statuses: string[] = [];
    const ws = new ReconnectingWs({
      url: "ws://x", coins: ["BTC"], factory,
      onStatus: (s) => statuses.push(s),
    });
    ws.start();
    sockets[0]!.fireOpen();

    // 1st drop -> wait 1s
    sockets[0]!.fireClose();
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(999); expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);   expect(sockets).toHaveLength(2);

    // 2nd drop -> wait 2s
    sockets[1]!.fireOpen();
    sockets[1]!.fireClose();
    vi.advanceTimersByTime(2000); expect(sockets).toHaveLength(3);

    expect(statuses).toContain("connected");
    expect(statuses).toContain("reconnecting");
    vi.useRealTimers();
  });

  it("caps backoff at 30s", () => {
    vi.useFakeTimers();
    const { sockets, factory } = setup();
    const ws = new ReconnectingWs({ url: "ws://x", coins: ["BTC"], factory });
    ws.start();
    // Force many consecutive failures before any open.
    for (let i = 0; i < 10; i++) {
      sockets[i]!.fireClose();
      vi.advanceTimersByTime(30_000);
    }
    // After 10 backoffs each <=30s, we created 11 sockets (initial + 10 retries).
    expect(sockets.length).toBe(11);
    vi.useRealTimers();
  });

  it("stop() closes the socket and prevents reconnect", () => {
    vi.useFakeTimers();
    const { sockets, factory } = setup();
    const ws = new ReconnectingWs({ url: "ws://x", coins: ["BTC"], factory });
    ws.start();
    sockets[0]!.fireOpen();
    ws.stop();
    expect(sockets[0]!.closed).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1); // no reconnect after stop
    vi.useRealTimers();
  });
});
