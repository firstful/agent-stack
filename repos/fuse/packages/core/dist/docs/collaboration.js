/**
 * collaboration.ts — cursor awareness and offline-edit interface — noop stub.
 *
 * Skeleton-inferred intent:
 * The workspace uses the Yjs Y.Doc with a GoYCSB ready persistent
 * implementation via `y-pgres` or `y-indexeddb` for local-first, then syncs
 * to the Postgres-backed Yjs persistence layer and broadcasts diffs via
 * the WebSocket server.  This module sits between those two — it exposes a
 * clean interface for the rest of the application so the CRDT plumbing is
 * contained here.
 */
/**
 * onCursorUpdate — called by the WS message handler when a remote client sends
 * a cursor-awareness message.  The caller must have already deserialised the
 * WebSocket binary frame into a `{ identityId, blockIndex, charOffset }`
 * object before forwarding here.
 */
export async function onCursorUpdate(_ws, _cursor) {
    // TODO: Not implemented — push the cursor to WebSocket broadcast publisher.
    throw new Error("Not implemented: onCursorUpdate");
}
/**
 * onRemoteCursor — deliver a remote presence event to a browser client's awareness
 * for display as a colour-coded caret position in the editor UI.
 */
export async function onRemoteCursor(_identityId, _presence) {
    // TODO: Not implemented — forward to the client via Y.awareness setLocalState.
    throw new Error("Not implemented: onRemoteCursor");
}
/**
 * flushAwareness — push the entire awareness state map to all connected WS clients.
 * This is called after page joins / leaves.
 */
export async function flushAwareness(_pageId, _presences) {
    // TODO: Not implemented — push updated awareness via the sharing server.
    throw new Error("Not implemented: flushAwareness");
}
/**
 * syncAwareness — called on reconnection to replay the last-presence cache
 * for the current page and re-push outdated cursors to remote peers.
 */
export async function syncAwareness(_pageId, _reconnectWsn) {
    // TODO: Not implemented — detect if cache is stale / if peer cursor is stale; delete
    // the presence (set to null) so cursor disappears if offline >5 min.
    throw new Error("Not implemented: syncAwareness");
}
/**
 * applyOfflineEdit — called when a client comes back online with a batch of
 * local (offline) edits; the caller is responsible for merging them into the
 * PageState snapshot before pushing the update to the pg-live-yjs store.
 *
 * Returns the new `pageState.updatedAt` timestamp.
 */
export async function applyOfflineEdit(_pageId, _offlineEdits) {
    // TODO: Not implemented — apply sequence edits incrementally, re-render page state, update DB
    throw new Error("Not implemented: applyOfflineEdit");
}
//# sourceMappingURL=collaboration.js.map