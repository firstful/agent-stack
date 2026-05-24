/**
 * bus.ts — typed, in-process FUSE event bus.
 *
 * The bus is an event emitter typed by `DomainEventType` so subscribers cannot
 * accidentally register for an event that does not exist.  It is synchronous
 * (no queuing) and should wrap async work at the subscriber level.
 */
import type { DomainEvent, DomainEventType } from "../types/event.js";
export type EventHandler = (ev: DomainEvent) => void | Promise<void>;
/**
 * EventBus — typed pub/sub for `DomainEvent`.
 */
export declare class EventBus {
    #private;
    /**
     * subscribe — register `handler` for events whose `type` matches `pattern`.
     *
     * `pattern` accepts a single discriminator string (e.g. `"message:created"`).
     * `handler` is called synchronously for every emitted event of that type.
     *
     * @returns An unsubscribe function.
     */
    subscribe(pattern: DomainEventType, handler: EventHandler): () => void;
    /**
     * emit — deliver `event` to all subscribers of `event.type`.
     * Returns a `Promise.all` of all subscriber results so callers can await
     * completion (e.g. inside transaction boundaries).
     */
    emit(event: DomainEvent): Promise<void>;
}
/** Singleton event bus — import everywhere with `import { eventBus } from "../events/bus.js"`. */
export declare const eventBus: EventBus;
//# sourceMappingURL=bus.d.ts.map