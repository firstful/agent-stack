/**
 * yjs.ts — Yjs CRDT integration stub — types and interface only.
 *
 * Skeleton-inferred intent:
 *   - Page state is stored as a Yjs YDoc binary, one per page, in MinIO on S3.
 *   - The Y.Doc binary is written with `encodeStateAsUpdate()` and then saved
 *     to a key like `pages/{pageId}/state.bin`.
 *   - A CRDT-aware Yjs websocket server (y-websocket) handles real-time
 *     multi-editor synchronization; miners clone using Y.decodeUpdate().
 *   - Block ordering and content merges are handled by the Yjs Text type (Y.Text)
 *     and the Yjs UndoManager for undo/redo.
 *   - Cursor awareness is piggybacked on the `y-protocols/awareness` protocol
 *     for showing other editors' caret / selection positions.
 *
 * Types
 * ────────────────────────────────────────────────────────────────────────────
 * YjsDoc          — wrapper type around the yjs Y.Doc instance
 * YBlockObserver  — callback interface notified on block-tree mutations
 * YSyncState      — holds the Y.Doc state vector + the previous state snapshot
 * YPresenceCursor — awareness awareness state — a per-identity cursor position
 *                   tracking.
 *
 * Wiring
 * ────────────────────────────────────────────────────────────────────────────
 * Pages are stored in-page in postgres object store S3 binary.
 * Each active page is kept in a Map where each key is a pageId, each value
 * is the Y.Doc instance for that page.
 */
/**
 * createYjsDoc — factory for YjsDoc.
 *  TODO: Not implemented — wire up y-websocket + Y.Doc in src/.
 */
export function createYjsDoc() {
    // TODO: Not implemented — wire up yjs / y-websocket
}
//# sourceMappingURL=yjs.js.map