export type FetchFn = typeof fetch;

export interface HttpConfig {
  baseUrl: string;
  fetchFn: FetchFn;
}

/** Strictly parse an HL string-number; throw on anything non-finite. */
export function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (typeof v !== "number" && (v === undefined || v === null || v === "")) {
    throw new Error(`not a number: ${String(v)}`);
  }
  if (!Number.isFinite(n)) throw new Error(`not a number: ${String(v)}`);
  return n;
}

/** POST a request body to the HL `/info` endpoint and return parsed JSON. */
export async function postInfo<T = unknown>(
  cfg: HttpConfig,
  body: Record<string, unknown>,
): Promise<T> {
  const res = await cfg.fetchFn(`${cfg.baseUrl}/info`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HL info ${res.status}`);
  return (await res.json()) as T;
}
