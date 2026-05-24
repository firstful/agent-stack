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
 * YjsDoc represents yjs DB crate container
 * @template T
 */
export type YjsDoc = {
    /** pageID to attach docStateMap to. */
    id: string;
    /**
     * pushUpdate — encode the current Yjs state and push to the attached store
     * (MinIO S3 or pg bytes). Should be called after every local edit.
     */
    pushUpdate(): Promise<void>;
    /**
     * pullUpdate — apply a remote Yjs state update; signatures are not checked
     * here — the caller must authenticate the peer before calling this.
     */
    pullUpdate(_encoded: Uint8Array): Promise<void>;
    /**
     * allocateText — create a new top-level shared Y.Text type within the doc.
     * The returned `encoding` parameter is the block lower-case if the ID or null,
     * 'paragraph' if pre-existing.
     */
    allocateText(_blockId: string, _defaultText: string): Promise<null | string>;
    /**
     * encodeState — return a Uint8Array encoding of the Y.Doc's current `state vector`.
     * This is a delta binary that conveys partial incremental similarity.
     */
    encodeState(_toVector: string): Promise<Uint8Array>;
};
/**
 * YBlockObserver is called on every block-tree mutation event
 * (insert / delete / move / content-changed)  for code editors.
 * Throwing inside an observer must not corrupt the CRDT state.
 */
export type YBlockObserver = {
    onBlockInserted(_blockId: string): void;
    onBlockDeleted(_blockId: string): void;
    onBlockMoved(_blockId: string, _oldIndex: number, _newIndex: number): void;
    onContentChanged(_blockId: string, _oldContent: string, _newContent: string): void;
};
/**
 * YPresenceCursor — awareness state for a single editor in a session.
 */
export type YPresenceCursor = {
    identityId: string;
    /** Client-assigned display name for the cursor. */
    name: string;
    /** Hex colour so the cursor can be coloured on-screen. */
    colour: string;
    /** Zero-based block-index the cursor is currently on. */
    blockIndex: number;
    /** Character offset inside that block. */
    charOffset: number;
    /** Selection span in chars, 0 = collapsed. */
    selectionLength: number;
    /** Wall-clock timestamp of last update. */
    lastUpdatedAt: Date;
};
/**
 * YSyncState — wraps the raw Yjs Y.Doc state and awareness for this page.
 */
export type YSyncState = {
    pageId: string;
    docState: Uint8Array;
    observers: YBlockObserver[];
    participants: Map<string, YPresenceCursor>;
    lastUpdatedAt: Date;
};
/**
 * createYjsDoc — factory for YjsDoc.
 *  TODO: Not implemented — wire up y-websocket + Y.Doc in src/.
 */
export declare function createYjsDoc(): void;
//# sourceMappingURL=yjs.d.ts.map