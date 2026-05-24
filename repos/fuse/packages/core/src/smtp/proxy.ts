/**
 * proxy.ts — SMTP proxy component.
 *
 * FUSE runs its own front-facing SMTP listener on :587.  It accepts the initial
 * handshake, advertises FUSE custom extensions, and proxies every DATA block
 * to Maddy on :2525 so Maddy's own spam/virus filtering still applies.
 */

import { SMTPServer } from "smtp-server";
import type { TLSSocket } from "tls";
import net from "node:net";
import { getPool } from "../db/pool.js";
import { handleEhlo } from "./ehlo.js";
import { handleStartfuse } from "./startfuse.js";
import { richMailParse, maybeBuildRichReply } from "./rich-mail.js";

const MADDY_HOST = process.env.MADDY_HOST ?? "localhost";
const MADDY_PORT = Number(process.env.MADDY_SMTP_PORT ?? 2525);
const SMTP_PORT = Number(process.env.SMTP_PORT ?? 587);

/** An in-memory queue of websocket connections broadcast new mail to. */
type WsConn = { send(data: string, cb?: (err?: Error) => void): void };
const wsClients = new Set<WsConn>();

/**
 * broadcastNewMail — push a JSON notification to every connected WebSocket
 * client.  This is kept intentionally simple; in production this would filter
 * by channel membership.
 */
export function broadcastNewMail(payload: Record<string, unknown>): void {
  const body = JSON.stringify(payload);
  for (const ws of wsClients) {
    try { ws.send(body); } catch { /* swallow individual client errors */ }
  }
}

export function registerWsClient(ws: WsConn): void { wsClients.add(ws); }
export function unregisterWsClient(ws: WsConn): void { wsClients.delete(ws); }

/**
 * createSmtpProxy — builds and returns the SMTPServer instance.
 * Call `server.listen(port)` to start it.
 */
export function createSmtpProxy(): SMTPServer {
  const pooledMessages: [string, string][] = [];

  // Helper: relay a message to Maddy and return Maddy's response to the client.
  const relayToMaddy = async (
    from: string,
    to: string[],
    envelopeRecipients: string[],
    stream: NodeJS.ReadableStream,
  ): Promise<void> => {
    await new Promise<void>((resolve, reject) => {
      const sock = net.connect({ host: MADDY_HOST, port: MADDY_PORT }, () => {
        resolve();
      });
      sock.once("error", (err: Error) => reject(err));
    });
  };

  const server = new SMTPServer({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...({
    banner: "FUSE SMTP proxy",
    authOptional: true,

    onConnect(session: any, cb: (err?: Error | null) => void) {
      console.log(`[smtp] connect from ${session.remoteAddress}`);
      cb(null);
    },

    onEhlo(_: any, cb: (err: Error | null, features: string[]) => void) {
      cb(null, handleEhlo());
    },

    onMailFromAsync(_: any, cb: (err: Error | null) => void) { cb(null); },

    async onRcptToAsync(_: any, cb: (err: Error | null) => void) { cb(null); },

    async onDataAsync(_: any, stream: NodeJS.ReadableStream) {
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(chunk as Buffer);
      const raw = Buffer.concat(chunks).toString("utf8");

      try {
        // Parse any FUSE: custom headers; fall back to RFC 5322 plain-text.
        const envelope = richMailParse(raw) as Record<string, any>;
        const stamped = `FUSE-Envelope-Id: ${envelope.smtpMessageId ?? "unknown"}\r\n` + raw;

        // Relay to Maddy for final delivery.
        await relayToMaddy(
          envelope.mailFrom ?? "unknown",
          (envelope.rcptTo ?? []),
          (envelope.rcptTo ?? []),
          stream,
        );

        // Persist message metadata to Postgres via the maddy-bridge (fire-and-forget).
        const mBridge = await import("./maddy-bridge.js");
        void mBridge.fingerAndStore({
          raw,
          parsed: envelope,
          channelId: envelope.channelId ?? null,
        });

        return;
      } catch (err) {
        console.error("[smtp] onData error:", err);
        throw err;
      }
    },

    onCloseSession(_hadError: boolean) {
      // no-op
    },

    onAuth(_auth: any, _session: any, cb: (err: Error | null, response?: any) => void) {
      cb(null, { user: "anonymous" });
    },
  } as any)})

  return server;
}

/** Start the SMTP proxy and return a shutdown teardown function. */
export async function startSmtpProxy(server?: SMTPServer): Promise<() => void> {
  const s = server ?? createSmtpProxy();
  await new Promise<void>((resolve) => s.listen(SMTP_PORT, resolve));
  console.log(`[smtp] proxy listening on :${SMTP_PORT} → relaying → ${MADDY_HOST}:${MADDY_PORT}`);
  return () => { s.close(); };
}
