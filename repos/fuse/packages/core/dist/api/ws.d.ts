/**
 * ws.ts — WebSocket server for real-time events.
 *
 * Bridges FUSE Pub/Sub events (presence, typing, new messages) to connected
 * browser / desktop clients.  Uses the `ws` npm package.
 */
import { WebSocketServer } from "ws";
/**
 * createWsServer — attaches a WebSocket server to a running HTTP server.
 *
 * @param httpServer  The Node.js `http.Server` returned by `app.listen()`.
 * @param path        WS path prefix (default `"/ws"`).
 * @returns           The `WebSocketServer` instance (call `.close()` on shutdown).
 */
export declare function createWsServer(httpServer: import("http").Server, path?: string): WebSocketServer;
//# sourceMappingURL=ws.d.ts.map