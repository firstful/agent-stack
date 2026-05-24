/**
 * providers/queue.ts — background job queue provider adapters.
 *
 * Core uses Bull (backed by Redis) for standard jobs.  For long-retention
 * or cross-region dead-lettering, jobs can be forwarded to SQS / PubSub.
 */
// ── Redis / Bull (generic) ───────────────────────────────────────────────
class RedisQueueProvider {
    async enqueue(job, payload) {
        // TODO: implement Bull queue
        console.log(`[queue] Enqueued ${job}`, payload);
    }
}
// ── Factory ──────────────────────────────────────────────────────────────
export function createQueueProvider(providerName) {
    switch (providerName) {
        case "aws-sqs":
        case "gcp-pubsub":
        // TODO: implement native SDK adapters
        default:
            return new RedisQueueProvider();
    }
}
//# sourceMappingURL=queue.js.map