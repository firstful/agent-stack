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
/**
 * handleStartfuse — the SMTP verb handler registered via the SMTPServer extension.
 *
 * @param session   The SMTPServer session object.
 * @param arg       Argument string (may carry auth token per the TBD spec).
 * @param callback  Node-style callback `(err, responseCode)`.
 */
export declare function handleStartfuse(session: {
    remoteAddress: string;
}, arg: string, callback: (err: Error | null, responseCode?: number) => void): void;
/**
 * closes an active STARTFUSE session by ID.
 */
export declare function closeFuseSession(sessionId: string): boolean;
/**
 * getSession — retrieve session metadata by ID.
 */
export declare function getSession(sessionId: string): {
    remoteAddress: string;
    createdAt: Date;
} | null;
/**
 * gcExpiredSessions — remove sessions older than 30 seconds.
 * Should be called periodically by the caller.
 */
export declare function gcExpiredSessions(): void;
//# sourceMappingURL=startfuse.d.ts.map