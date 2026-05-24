/**
 * bus.ts — typed, in-process FUSE event bus.
 *
 * The bus is an event emitter typed by `DomainEventType` so subscribers cannot
 * accidentally register for an event that does not exist.  It is synchronous
 * (no queuing) and should wrap async work at the subscriber level.
 */

import type { DomainEvent, DomainEventType, MessageEvent } from "../types/event.js";

export type EventHandler = (ev: DomainEvent) => void | Promise<void>;

/**
 * EventBus — typed pub/sub for `DomainEvent`.
 */
export class EventBus {
  /** `type → Set<Handler>` map. */
  #map: Map<DomainEventType, Set<EventHandler>> = new Map();

  /**
   * subscribe — register `handler` for events whose `type` matches `pattern`.
   *
   * `pattern` accepts a single discriminator string (e.g. `"message:created"`).
   * `handler` is called synchronously for every emitted event of that type.
   *
   * @returns An unsubscribe function.
   */
  subscribe(pattern: DomainEventType, handler: EventHandler): () => void {
    const set = this.#map.get(pattern) ?? new Set<EventHandler>();
    set.add(handler);
    this.#map.set(pattern, set);
    return () => {
      set.delete(handler);
      if (set.size === 0) this.#map.delete(pattern);
    };
  }

  /**
   * emit — deliver `event` to all subscribers of `event.type`.
   * Returns a `Promise.all` of all subscriber results so callers can await
   * completion (e.g. inside transaction boundaries).
   */
  async emit(event: DomainEvent): Promise<void> {
    const set = this.#map.get(event.type);
    if (!set || set.size === 0) return;
    const results: (void | Promise<void>)[] = [];
    for (const h of set) results.push(h(event));
    await Promise.all(results);
  }
}

/** Singleton event bus — import everywhere with `import { eventBus } from "../events/bus.js"`. */
export const eventBus = new EventBus();
