/**
 * notification.ts — Postgres LISTEN/NOTIFY → WebSocket broadcast bridge.
 *
 * Bridges new-message notifications (fired by the Postgres trigger defined in
 * migrations/001_initial.sql) to the FUSE WebSocket cluster using the shared
 * broadcast helper from smtp/proxy.ts.
 */
/**
 * startNotificationBridge — attaches a second LISTEN connection and broadcasts
 * every `message:created` notification to the WS cluster.
 *
 * @returns Teardown function.
 */
export declare function startNotificationBridge(): Promise<() => void>;
/**
 * onWsOpen — register a new WebSocket connection for broadcast targeting.
 */
export declare function onWsOpen(ws: {
    send(data: string, cb?: (err?: Error) => void): void;
}): void;
/**
 * onWsClose — unregister a WebSocket connection when it closes.
 */
export declare function onWsClose(ws: {
    send(data: string, cb?: (err?: Error) => void): void;
}): void;
//# sourceMappingURL=notification.d.ts.map