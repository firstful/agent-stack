/**
 * proxy.ts — SMTP proxy component.
 *
 * FUSE runs its own front-facing SMTP listener on :587.  It accepts the initial
 * handshake, advertises FUSE custom extensions, and proxies every DATA block
 * to Maddy on :2525 so Maddy's own spam/virus filtering still applies.
 */
import { SMTPServer } from "smtp-server";
/** An in-memory queue of websocket connections broadcast new mail to. */
type WsConn = {
    send(data: string, cb?: (err?: Error) => void): void;
};
/**
 * broadcastNewMail — push a JSON notification to every connected WebSocket
 * client.  This is kept intentionally simple; in production this would filter
 * by channel membership.
 */
export declare function broadcastNewMail(payload: Record<string, unknown>): void;
export declare function registerWsClient(ws: WsConn): void;
export declare function unregisterWsClient(ws: WsConn): void;
/**
 * createSmtpProxy — builds and returns the SMTPServer instance.
 * Call `server.listen(port)` to start it.
 */
export declare function createSmtpProxy(): SMTPServer;
/** Start the SMTP proxy and return a shutdown teardown function. */
export declare function startSmtpProxy(server?: SMTPServer): Promise<() => void>;
export {};
//# sourceMappingURL=proxy.d.ts.map