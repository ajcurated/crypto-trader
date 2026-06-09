import { describe, it, expect, vi } from "vitest";
import { HyperLiquidDataSource } from "./HyperLiquidDataSource.js";
import type { SocketLike, SocketFactory } from "./ws.js";
import type { FetchFn } from "./http.js";
import meta from "../__fixtures__/metaAndAssetCtxs.json" with { type: "json" };
import candles from "../__fixtures__/candleSnapshot.json" with { type: "json" };

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe("HyperLiquidDataSource REST", () => {
  it("getUniverse returns top-N parsed contexts", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(meta));
    const ds = new HyperLiquidDataSource({ baseUrl: "https://x", fetchFn });
    const out = await ds.getUniverse(2);
    expect(out.map((c) => c.name)).toEqual(["ETH", "BTC"]);
  });

  it("getDailyCandles posts a candleSnapshot request and parses the result", async () => {
    const fetchFn = vi.fn<FetchFn>(async () => jsonResponse(candles));
    const ds = new HyperLiquidDataSource({ baseUrl: "https://x", fetchFn });
    const out = await ds.getDailyCandles("BTC", 2);

    expect(out).toHaveLength(2);
    const body = JSON.parse((fetchFn.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.type).toBe("candleSnapshot");
    expect(body.req.coin).toBe("BTC");
    expect(body.req.interval).toBe("1d");
  });
});

describe("HyperLiquidDataSource watch", () => {
  it("delivers AssetContext updates from WS ctx messages", () => {
    let socket: SocketLike & { sent: string[] };
    const factory: SocketFactory = () => {
      socket = {
        sent: [] as string[],
        send(d: string) { this.sent.push(d); },
        close() {},
        onopen: null, onmessage: null, onclose: null, onerror: null,
      } as SocketLike & { sent: string[] };
      return socket;
    };
    const ds = new HyperLiquidDataSource({ baseUrl: "https://x", fetchFn: vi.fn(), wsFactory: factory });

    const got: string[] = [];
    const handle = ds.watch(["BTC"], { onCtx: (c) => got.push(c.name) });
    socket!.onopen!();
    socket!.onmessage!(JSON.stringify({
      channel: "activeAssetCtx",
      data: { coin: "BTC", ctx: {
        dayNtlVlm: "1", funding: "0", markPx: "1", midPx: "1",
        oraclePx: "1", prevDayPx: "1", openInterest: "1",
      } },
    }));

    expect(got).toEqual(["BTC"]);
    expect(handle.status()).toBe("connected");
    handle.close();
  });
});
