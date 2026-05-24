/**
 * ws.ts — WebSocket server for real-time events.
 *
 * Bridges FUSE Pub/Sub events (presence, typing, new messages) to connected
 * browser / desktop clients.  Uses the `ws` npm package.
 */
import { WebSocketServer } from "ws";
import { registerWsClient as onWsOpen, unregisterWsClient as onWsClose } from "../smtp/proxy.js";
/**
 * createWsServer — attaches a WebSocket server to a running HTTP server.
 *
 * @param httpServer  The Node.js `http.Server` returned by `app.listen()`.
 * @param path        WS path prefix (default `"/ws"`).
 * @returns           The `WebSocketServer` instance (call `.close()` on shutdown).
 */
export function createWsServer(httpServer, path = "/ws") {
    const wss = new WebSocketServer({ server: httpServer, path });
    wss.on("connection", (rawWs) => {
        const ws = rawWs;
        ws.isAlive = true;
        ws.on("pong", () => { ws.isAlive = true; });
        onWsOpen(ws);
        console.log(`[ws] client connected  (total=${wss.clients.size})`);
        ws.on("message", (raw) => {
            let msg;
            try {
                msg = JSON.parse(raw.toString());
            }
            catch {
                return;
            }
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
                    send(ws, { op: "error", code: "UNKNOWN_OP", message: `Unknown op: ${msg.op}` });
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
            if (wsCli.isAlive === false) {
                wsCli.terminate();
            }
            else {
                wsCli.isAlive = false;
                wsCli.ping();
            }
        }
    }, 30_000);
    wss.on("close", () => clearInterval(heartbeat));
    console.log(`[ws] server ready on path="${path}"`);
    return wss;
}
/** send — JSON-stringify a `ServerMessage` and send it over the wire. */
function send(ws, msg) {
    try {
        ws.send(JSON.stringify(msg), () => { });
    }
    catch { /* swallow */ }
}
//# sourceMappingURL=ws.js.map