import { createServer, type Server } from "node:http";
import type { Datastore } from "../core/store/index.js";
import { handleDashboardRequest } from "./handler.js";

/** Start a local HTTP dashboard server backed by `store`. Returns the server. */
export function startDashboardServer(store: Datastore, port: number): Server {
  const server = createServer((req, res) => {
    const { status, contentType, body } = handleDashboardRequest(store, req.url ?? "/");
    res.writeHead(status, { "content-type": contentType });
    res.end(body);
  });
  server.listen(port);
  return server;
}
