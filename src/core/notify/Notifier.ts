/** Sends a short human-readable alert somewhere (console, Telegram, ...). */
export interface Notifier {
  send(message: string): Promise<void>;
}
