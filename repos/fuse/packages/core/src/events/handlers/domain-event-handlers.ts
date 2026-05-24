/**
 * handlers/domain-event-handlers.ts — noop stubs for domain lifecycle events.
 *
 * Skeleton intent:
 *   - `domain:created`              — provisioning: create default `#general`, `#random`, `#meta`
 *     channels; set up default domain config DNS txt record; emit to admin console.
 *   - `domain:updated`              — apply config changes (trust_level, federation_enabled)
 *     without restart; invalidate domain config cache.
 *   - `domain:deleted`              — cascade-delete all identities, channels, and messages;
 *     force revoke all sessions.  WARNING: irreversible.
 *   - `domain:trust_level_changed`  — push to WebSocket admin panel; audit the reason
 *     in a separate `trust_audit_log` which is not in v1 migration but TBD in v2.
 */

import { eventBus } from "../bus.js";

// ── domain:created ──────────────────────────────────────────────────────────

/**
 * Skeleton-inferred intent:
 *   1. Create default channels: #general (public), #random (public), #meta (private).
 *   2. Set up the domain config record (DEFAULT_RECV_MSG=2048, FUSE_FEDERATION=0).
 *   3. Emit `domain:created` → admin console WebSocket namespace.
 */
eventBus.subscribe("domain:created", (_ev: any) => {
  const ev = _ev as any;
  console.log({type: 'domain:created', domainId: ev.domainId, actorId: ev.actorId});
  // TODO: Not implemented — provision default channels and config.
});

// ── domain:updated ───────────────────────────────────────────────────────────

eventBus.subscribe("domain:updated", (_ev: any) => {
  const ev = _ev as any;
  console.log({type: 'domain:updated', domainId: ev.domainId, changes: ev.changes});
  // TODO: Not implemented — hot-reload domain config without restart.
});

// ── domain:deleted ───────────────────────────────────────────────────────────

eventBus.subscribe("domain:deleted", (_ev: any) => {
  const ev = _ev as any;
  console.log({type: 'domain:deleted', domainId: ev.domainId, actorId: ev.actorId});
  // TODO: Not implemented — cascade-cleanup identities, channels, messages, sessions.
});

// ── domain:trust_level_changed ───────────────────────────────────────────────

eventBus.subscribe("domain:trust_level_changed", (_ev: any) => {
  const ev = _ev as any;
  console.log({type: 'domain:trust_level_changed', domainId: ev.domainId, trustLevel: ev.trustLevel, actorId: ev.actorId});
  // TODO: Not implemented — audit trust-level transitions, push update to WS.
});
