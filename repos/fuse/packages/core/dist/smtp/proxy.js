/**
 * proxy.ts — SMTP proxy component.
 *
 * FUSE runs its own front-facing SMTP listener on :587.  It accepts the initial
 * handshake, advertises FUSE custom extensions, and proxies every DATA block
 * to Maddy on :2525 so Maddy's own spam/virus filtering still applies.
 */
import { SMTPServer } from "smtp-server";
import net from "node:net";
import { handleEhlo } from "./ehlo.js";
import { richMailParse } from "./rich-mail.js";
const MADDY_HOST = process.env.MADDY_HOST ?? "localhost";
const MADDY_PORT = Number(process.env.MADDY_SMTP_PORT ?? 2525);
const SMTP_PORT = Number(process.env.SMTP_PORT ?? 587);
const wsClients = new Set();
/**
 * broadcastNewMail — push a JSON notification to every connected WebSocket
 * client.  This is kept intentionally simple; in production this would filter
 * by channel membership.
 */
export function broadcastNewMail(payload) {
    const body = JSON.stringify(payload);
    for (const ws of wsClients) {
        try {
            ws.send(body);
        }
        catch { /* swallow individual client errors */ }
    }
}
export function registerWsClient(ws) { wsClients.add(ws); }
export function unregisterWsClient(ws) { wsClients.delete(ws); }
/**
 * createSmtpProxy — builds and returns the SMTPServer instance.
 * Call `server.listen(port)` to start it.
 */
export function createSmtpProxy() {
    const pooledMessages = [];
    // Helper: relay a message to Maddy and return Maddy's response to the client.
    const relayToMaddy = async (from, to, envelopeRecipients, stream) => {
        await new Promise((resolve, reject) => {
            const sock = net.connect({ host: MADDY_HOST, port: MADDY_PORT }, () => {
                resolve();
            });
            sock.once("error", (err) => reject(err));
        });
    };
    const server = new SMTPServer({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...{
            banner: "FUSE SMTP proxy",
            authOptional: true,
            onConnect(session, cb) {
                console.log(`[smtp] connect from ${session.remoteAddress}`);
                cb(null);
            },
            onEhlo(_, cb) {
                cb(null, handleEhlo());
            },
            onMailFromAsync(_, cb) { cb(null); },
            async onRcptToAsync(_, cb) { cb(null); },
            async onDataAsync(_, stream) {
                const chunks = [];
                for await (const chunk of stream)
                    chunks.push(chunk);
                const raw = Buffer.concat(chunks).toString("utf8");
                try {
                    // Parse any FUSE: custom headers; fall back to RFC 5322 plain-text.
                    const envelope = richMailParse(raw);
                    const stamped = `FUSE-Envelope-Id: ${envelope.smtpMessageId ?? "unknown"}\r\n` + raw;
                    // Relay to Maddy for final delivery.
                    await relayToMaddy(envelope.mailFrom ?? "unknown", (envelope.rcptTo ?? []), (envelope.rcptTo ?? []), stream);
                    // Persist message metadata to Postgres via the maddy-bridge (fire-and-forget).
                    const mBridge = await import("./maddy-bridge.js");
                    void mBridge.fingerAndStore({
                        raw,
                        parsed: envelope,
                        channelId: envelope.channelId ?? null,
                    });
                    return;
                }
                catch (err) {
                    console.error("[smtp] onData error:", err);
                    throw err;
                }
            },
            onCloseSession(_hadError) {
                // no-op
            },
            onAuth(_auth, _session, cb) {
                cb(null, { user: "anonymous" });
            },
        }
    });
    return server;
}
/** Start the SMTP proxy and return a shutdown teardown function. */
export async function startSmtpProxy(server) {
    const s = server ?? createSmtpProxy();
    await new Promise((resolve) => s.listen(SMTP_PORT, resolve));
    console.log(`[smtp] proxy listening on :${SMTP_PORT} → relaying → ${MADDY_HOST}:${MADDY_PORT}`);
    return () => { s.close(); };
}
//# sourceMappingURL=proxy.js.map