/**
 * handlers/document-event-handlers.ts — noop stubs for document lifecycle events.
 *
 * Skeleton intent:
 *   - `document:created`      — write initial Yjs state to object store (MinIO) keyed by PAGE_BINARY_FORMAT.
 *   - `document:updated`      — emit `document:updated` to WS so connected editors reload the page.
 *   - `document:block_upserted` — write Yjs delta to the page binary, broadcast `block:upserted`.
 *   - `document:block_deleted`  — soft-delete block (deleted_at = now()); broadcast tombstone.
 */

import { eventBus } from "../bus.js";

// ── document:created ──────────────────────────────────────────────────────────

/**
 * Skeleton-inferred intent:
 *   1. Persist initial Yjs document binary to MinIO (key = `pages/${pageId}/state.bin`).
 *   2. Broadcast `document:created` to channel-wide WS namespace.
 *   3. If `page.template` is set, hydrate the page from the template definition.
 */
eventBus.subscribe("document:created", (_ev: any) => {
  const ev = _ev as any;
  console.log({type: 'document:created', documentId: ev.documentId, actorId: ev.actorId});
  // TODO: Not implemented — persist Yjs state, broadcast, apply template.
});

// ── document:updated ───────────────────────────────────────────────────────────

/**
 * Skeleton-inferred intent:
 *   1. Apply Yjs update binary to the page state snapshot in object storage.
 *   2. Send a WS `document:updated` event containing the updatedAt timestamp and
 *      an `updateId` so clients can deduplicate if they reconnect while offline.
 */
eventBus.subscribe("document:updated", (_ev: any) => {
  const ev = _ev as any;
  console.log({type: 'document:updated', documentId: ev.documentId, updatedAt: ev.updatedAt});
  // TODO: Not implemented — apply Yjs update, broadcast.
});

// ── document:block_upserted ───────────────────────────────────────────────────

eventBus.subscribe("document:block_upserted", (_ev: any) => {
  const ev = _ev as any;
  console.log({type: 'document:block_upserted', documentId: ev.documentId, blockId: ev.blockId, actorId: ev.actorId});
  // TODO: Not implemented — persist Yjs block delta, broadcast to browsers.
});

// ── document:block_deleted ────────────────────────────────────────────────────

eventBus.subscribe("document:block_deleted", (_ev: any) => {
  const ev = _ev as any;
  console.log({type: 'document:block_deleted', documentId: ev.documentId, blockId: ev.blockId, actorId: ev.actorId});
  // TODO: Not implemented — mark block deleted in Yjs doc, broadcast tombstone.
});
