import { createServer, type Server } from "node:http";
import { logger } from "./config.js";

export function startHealthServer(
  port: number,
  isHealthy: () => boolean,
): Server {
  const server = createServer((req, res) => {
    if (req.url === "/health" && req.method === "GET") {
      const connected = isHealthy();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", connected }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.listen(port, () => {
    logger.info({ port }, "Health server listening");
  });

  return server;
}
