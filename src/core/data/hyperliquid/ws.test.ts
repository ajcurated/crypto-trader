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

  it("escalates backoff exponentially while it cannot reconnect", () => {
    vi.useFakeTimers();
    const { sockets, factory } = setup();
    const statuses: string[] = [];
    const ws = new ReconnectingWs({
      url: "ws://x", coins: ["BTC"], factory,
      onStatus: (s) => statuses.push(s),
    });
    ws.start();
    sockets[0]!.fireOpen(); // connected -> backoff counter at 0

    // 1st drop -> wait exactly 1s (2^0)
    sockets[0]!.fireClose();
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(999); expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);   expect(sockets).toHaveLength(2);

    // socket[1] never opens (can't establish) -> next wait is 2s (2^1)
    sockets[1]!.fireClose();
    vi.advanceTimersByTime(1999); expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);    expect(sockets).toHaveLength(3);

    // still can't establish -> next wait is 4s (2^2)
    sockets[2]!.fireClose();
    vi.advanceTimersByTime(3999); expect(sockets).toHaveLength(3);
    vi.advanceTimersByTime(1);    expect(sockets).toHaveLength(4);

    expect(statuses).toContain("connected");
    expect(statuses).toContain("reconnecting");
    vi.useRealTimers();
  });

  it("resets backoff to 1s after a successful open (fast recovery)", () => {
    vi.useFakeTimers();
    const { sockets, factory } = setup();
    const ws = new ReconnectingWs({ url: "ws://x", coins: ["BTC"], factory });
    ws.start();

    // Climb the backoff via two failed connects: 1s then 2s.
    sockets[0]!.fireClose();
    vi.advanceTimersByTime(1000); // -> socket[1]
    sockets[1]!.fireClose();
    vi.advanceTimersByTime(2000); // -> socket[2]
    expect(sockets).toHaveLength(3);

    // socket[2] opens successfully, resetting the backoff counter.
    sockets[2]!.fireOpen();

    // A subsequent drop now backs off only 1s again, not 4s.
    sockets[2]!.fireClose();
    vi.advanceTimersByTime(999); expect(sockets).toHaveLength(3);
    vi.advanceTimersByTime(1);   expect(sockets).toHaveLength(4);
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
