import type { Notifier } from "./Notifier.js";

type FetchFn = typeof fetch;

/** Sends alerts to a Telegram chat via the Bot API. */
export class TelegramNotifier implements Notifier {
  constructor(
    private readonly token: string,
    private readonly chatId: string,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  async send(message: string): Promise<void> {
    const res = await this.fetchFn(`https://api.telegram.org/bot${this.token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: this.chatId, text: message }),
    });
    if (!res.ok) throw new Error(`telegram ${res.status}`);
  }
}
