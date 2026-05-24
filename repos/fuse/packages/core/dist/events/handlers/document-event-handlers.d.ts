/**
 * handlers/document-event-handlers.ts — noop stubs for document lifecycle events.
 *
 * Skeleton intent:
 *   - `document:created`      — write initial Yjs state to object store (MinIO) keyed by PAGE_BINARY_FORMAT.
 *   - `document:updated`      — emit `document:updated` to WS so connected editors reload the page.
 *   - `document:block_upserted` — write Yjs delta to the page binary, broadcast `block:upserted`.
 *   - `document:block_deleted`  — soft-delete block (deleted_at = now()); broadcast tombstone.
 */
export {};
//# sourceMappingURL=document-event-handlers.d.ts.map