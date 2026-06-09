import type { Notifier } from "./Notifier.js";

/** Writes alerts to stdout. Always available, no credentials. */
export class ConsoleNotifier implements Notifier {
  async send(message: string): Promise<void> {
    console.log(`[alert] ${message}`);
  }
}
