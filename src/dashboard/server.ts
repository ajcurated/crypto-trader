import { createServer, type Server } from "node:http";
import type { Datastore } from "../core/store/index.js";
import { handleDashboardRequest, type DashboardOpts } from "./handler.js";

/** Start an HTTP dashboard server backed by `store` (optionally live + authed). */
export function startDashboardServer(
  store: Datastore,
  port: number,
  opts: Omit<DashboardOpts, "authHeader"> = {},
): Server {
  const server = createServer((req, res) => {
    const { status, contentType, body, headers } = handleDashboardRequest(store, req.url ?? "/", {
      ...opts,
      authHeader: req.headers.authorization,
    });
    res.writeHead(status, { "content-type": contentType, ...headers });
    res.end(body);
  });
  server.listen(port);
  return server;
}
