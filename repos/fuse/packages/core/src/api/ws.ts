/**
 * ws.ts — WebSocket server for real-time events.
 *
 * Bridges FUSE Pub/Sub events (presence, typing, new messages) to connected
 * browser / desktop clients.  Uses the `ws` npm package.
 */

import { WebSocketServer, type WebSocket } from "ws";
import { broadcastNewMail, registerWsClient as onWsOpen, unregisterWsClient as onWsClose } from "../smtp/proxy.js";

/** Client -> server message types recognised by this layer. */
type ClientMessage =
  | { op: "presence:ping" }
  | { op: "typing:start"; channelId: string }
  | { op: "typing:stop"; channelId: string };

/** Server -> client message types. */
type ServerMessage =
  | { event: "presence:updated"; identityId: string; status: string; timestamp: string }
  | { event: "typing:started"; channelId: string; identityId: string; timestamp: string }
  | { event: "typing:stopped";  channelId: string; identityId: string; timestamp: string }
  | { event: "message:created"; data: Record<string, unknown> }
  | { op: "error"; code: string; message: string };

/**
 * createWsServer — attaches a WebSocket server to a running HTTP server.
 *
 * @param httpServer  The Node.js `http.Server` returned by `app.listen()`.
 * @param path        WS path prefix (default `"/ws"`).
 * @returns           The `WebSocketServer` instance (call `.close()` on shutdown).
 */
export function createWsServer(httpServer: import("http").Server, path = "/ws"): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path });

  wss.on("connection", (rawWs: WebSocket) => {
    const ws = rawWs as WebSocket & { isAlive: boolean };
    ws.isAlive = true;
    ws.on("pong", () => { ws.isAlive = true; });
    onWsOpen(ws);
    console.log(`[ws] client connected  (total=${wss.clients.size})`);

    ws.on("message", (raw: Buffer) => {
      let msg: ClientMessage;
      try { msg = JSON.parse(raw.toString()) as ClientMessage; } catch { return; }

      switch (msg.op) {
        case "presence:ping":
          // Reply with a pong and current server time.
          send(ws, { event: "presence:updated", identityId: "", status: "online", timestamp: new Date().toISOString() });
          break;
        case "typing:start":
          send(ws, { event: "typing:started", channelId: msg.channelId, identityId: "", timestamp: new Date().toISOString() });
          break;
        case "typing:stop":
          send(ws, { event: "typing:stopped", channelId: msg.channelId, identityId: "", timestamp: new Date().toISOString() });
          break;
        default:
          send(ws, { op: "error", code: "UNKNOWN_OP", message: `Unknown op: ${(msg as any).op}` });
      }
    });

    ws.on("close", () => {
      onWsClose(ws);
      console.log(`[ws] client disconnected  (total=${wss.clients.size - 1})`);
    });

    ws.on("error", (err) => console.error("[ws] error:", err));
  });

  // Heartbeat: close clients that don't respond to pings within 30 s.
  const heartbeat = setInterval(() => {
    for (const wsCli of wss.clients) {
      if ((wsCli as any).isAlive === false) {
        (wsCli as any).terminate();
      } else {
        (wsCli as any).isAlive = false;
        (wsCli as any).ping();
      }
    }
  }, 30_000);
  wss.on("close", () => clearInterval(heartbeat));

  console.log(`[ws] server ready on path="${path}"`);
  return wss;
}

/** send — JSON-stringify a `ServerMessage` and send it over the wire. */
function send(ws: { send(data: string, cb?: (err?: Error) => void): void }, msg: ServerMessage): void {
  try { ws.send(JSON.stringify(msg), () => {}); } catch { /* swallow */ }
}
