import type { Notifier } from "./Notifier.js";

/** Fans a message out to several notifiers; a failing one never blocks the rest. */
export class MultiNotifier implements Notifier {
  constructor(private readonly notifiers: Notifier[]) {}

  async send(message: string): Promise<void> {
    await Promise.all(
      this.notifiers.map((n) =>
        n.send(message).catch((err) => console.error("notifier failed:", err)),
      ),
    );
  }
}
