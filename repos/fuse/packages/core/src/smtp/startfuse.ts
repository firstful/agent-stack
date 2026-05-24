/**
 * startfuse.ts — STARTFUSE SMTP command handler.
 *
 * STARTFUSE is a FUSE-private SMTP verb that upgrades an existing TCP connection
 * into webhook-flow mode: the client stops sending RFC 5322 messages and instead
 * POSTs JSON payloads directly to the FUSE HTTP webhook endpoint, keyed by the
 * session ID that STARTFUSE allocates.
 *
 * TODO: underspecified — STARTFUSE token negotiation protocol is not yet
 * finalised; this stub returns `354 Start fuse session` and closes the session
 * after 30 s of inactivity.
 */

/** Session records currently held in memory. */
const sessions = new Map<string, { remoteAddress: string; createdAt: Date }>();

/**
 * handleStartfuse — the SMTP verb handler registered via the SMTPServer extension.
 *
 * @param session   The SMTPServer session object.
 * @param arg       Argument string (may carry auth token per the TBD spec).
 * @param callback  Node-style callback `(err, responseCode)`.
 */
export function handleStartfuse(
  session: { remoteAddress: string },
  arg: string,
  callback: (err: Error | null, responseCode?: number) => void,
): void {
  const sessionId = crypto.randomUUID();
  sessions.set(sessionId, {
    remoteAddress: session.remoteAddress,
    createdAt: new Date(),
  });

  console.log(`[smtp] STARTFUSE session ${sessionId} from ${session.remoteAddress}`);
  callback(null, 354); // 354 Start fuse session
}

/**
 * closes an active STARTFUSE session by ID.
 */
export function closeFuseSession(sessionId: string): boolean {
  return sessions.delete(sessionId);
}

/**
 * getSession — retrieve session metadata by ID.
 */
export function getSession(sessionId: string): { remoteAddress: string; createdAt: Date } | null {
  return sessions.get(sessionId) ?? null;
}

/**
 * gcExpiredSessions — remove sessions older than 30 seconds.
 * Should be called periodically by the caller.
 */
export function gcExpiredSessions(): void {
  const now = Date.now();
  for (const [id, s] of sessions.entries()) {
    if (now - s.createdAt.getTime() > 30_000) sessions.delete(id);
  }
}
