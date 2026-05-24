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
import type { YPresenceCursor } from "./yjs.js";
import { WebSocket } from "ws";
/**
 * onCursorUpdate — called by the WS message handler when a remote client sends
 * a cursor-awareness message.  The caller must have already deserialised the
 * WebSocket binary frame into a `{ identityId, blockIndex, charOffset }`
 * object before forwarding here.
 */
export declare function onCursorUpdate(_ws: WebSocket, _cursor: YPresenceCursor): Promise<void>;
/**
 * onRemoteCursor — deliver a remote presence event to a browser client's awareness
 * for display as a colour-coded caret position in the editor UI.
 */
export declare function onRemoteCursor(_identityId: string, _presence: YPresenceCursor): Promise<void>;
/**
 * flushAwareness — push the entire awareness state map to all connected WS clients.
 * This is called after page joins / leaves.
 */
export declare function flushAwareness(_pageId: string, _presences: YPresenceCursor[]): Promise<void>;
/**
 * syncAwareness — called on reconnection to replay the last-presence cache
 * for the current page and re-push outdated cursors to remote peers.
 */
export declare function syncAwareness(_pageId: string, _reconnectWsn: WebSocket): Promise<void>;
/**
 * applyOfflineEdit — called when a client comes back online with a batch of
 * local (offline) edits; the caller is responsible for merging them into the
 * PageState snapshot before pushing the update to the pg-live-yjs store.
 *
 * Returns the new `pageState.updatedAt` timestamp.
 */
export declare function applyOfflineEdit(_pageId: string, _offlineEdits: Record<string, unknown>[]): Promise<Date>;
//# sourceMappingURL=collaboration.d.ts.map