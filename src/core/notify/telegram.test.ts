import { describe, it, expect, vi } from "vitest";
import { TelegramNotifier } from "./telegram.js";

describe("TelegramNotifier", () => {
  it("POSTs the message to the Bot API sendMessage endpoint", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await new TelegramNotifier("TOKEN", "CHAT", fetchFn).send("hi there");

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("https://api.telegram.org/botTOKEN/sendMessage");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ chat_id: "CHAT", text: "hi there" });
  });

  it("throws on a non-2xx response", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response("nope", { status: 400 }));
    await expect(new TelegramNotifier("T", "C", fetchFn).send("x")).rejects.toThrow(/telegram 400/);
  });
});
