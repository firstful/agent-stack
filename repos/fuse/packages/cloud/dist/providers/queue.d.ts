/**
 * providers/queue.ts — background job queue provider adapters.
 *
 * Core uses Bull (backed by Redis) for standard jobs.  For long-retention
 * or cross-region dead-lettering, jobs can be forwarded to SQS / PubSub.
 */
import type { QueueProvider } from "./index.js";
export declare function createQueueProvider(providerName: string): QueueProvider;
//# sourceMappingURL=queue.d.ts.map