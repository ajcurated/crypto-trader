import { describe, it, expect, vi } from "vitest";
import type { Notifier } from "./Notifier.js";
import { ConsoleNotifier } from "./console.js";
import { MultiNotifier } from "./multi.js";

describe("ConsoleNotifier", () => {
  it("logs the message", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await new ConsoleNotifier().send("hello");
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("hello"));
    spy.mockRestore();
  });
});

describe("MultiNotifier", () => {
  it("fans out to every notifier", async () => {
    const a = { send: vi.fn(async () => {}) };
    const b = { send: vi.fn(async () => {}) };
    await new MultiNotifier([a, b]).send("x");
    expect(a.send).toHaveBeenCalledWith("x");
    expect(b.send).toHaveBeenCalledWith("x");
  });

  it("does not let one failing notifier stop the others (failures non-fatal)", async () => {
    const boom: Notifier = { send: vi.fn(async () => { throw new Error("down"); }) };
    const ok = { send: vi.fn(async () => {}) };
    await expect(new MultiNotifier([boom, ok]).send("x")).resolves.toBeUndefined();
    expect(ok.send).toHaveBeenCalledWith("x");
  });
});
