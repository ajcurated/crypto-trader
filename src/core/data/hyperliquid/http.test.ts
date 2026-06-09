import { describe, it, expect, vi } from "vitest";
import { num, postInfo } from "./http.js";

describe("num", () => {
  it("parses numeric strings, including scientific notation", () => {
    expect(num("65000.5")).toBe(65000.5);
    expect(num("0")).toBe(0);
    expect(num("1.5e3")).toBe(1500);
  });
  it("throws on non-numeric input", () => {
    expect(() => num("abc")).toThrow(/not a number/);
    expect(() => num(undefined)).toThrow(/not a number/);
    expect(() => num(null)).toThrow(/not a number/);
  });
});

describe("postInfo", () => {
  it("POSTs the body as JSON to <baseUrl>/info and returns parsed JSON", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const out = await postInfo({ baseUrl: "https://x", fetchFn }, { type: "meta" });

    expect(out).toEqual({ ok: true });
    expect(fetchFn).toHaveBeenCalledWith("https://x/info", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "meta" }),
    });
  });

  it("throws on non-2xx", async () => {
    const fetchFn = vi.fn(async () => new Response("nope", { status: 500 }));
    await expect(
      postInfo({ baseUrl: "https://x", fetchFn }, { type: "meta" }),
    ).rejects.toThrow(/HL info 500/);
  });
});
