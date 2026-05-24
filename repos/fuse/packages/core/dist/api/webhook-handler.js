/**
 * webhook-handler.ts — inbound webhook receive / verify route handlers (noop stubs).
 */
import { z } from "zod";
import { typedRoute } from "./router.js";
const STATUS_OK = { status: "webhook-handler stubs active — not implemented" };
export function mountWebhookRoutes(parent) {
    const r = parent;
    r.get("/webhooks/status", (_req, res) => res.json(STATUS_OK));
    // POST /domains/:domainId/webhooks — create webhook endpoint
    r.post("/domains/:domainId/webhooks", typedRoute(z.object({
        params: z.object({ domainId: z.string().uuid() }),
        query: z.object({}),
        body: z.object({
            url: z.string().url(),
            subscribedEvents: z.array(z.string()),
            secretToken: z.string(),
        }),
    }), async ({ input, request, response }) => {
        const identity = request.identity;
        if (!identity) {
            response.status(401).json({ error: "Not authenticated" });
            return;
        }
        console.log("[api] POST /webhooks", input.body);
        response.status(201).json({ id: crypto.randomUUID(), ...input.body });
    }));
    // GET /webhooks — list webhook endpoints for a domain
    r.get("/webhooks", typedRoute(z.object({
        params: z.object({}),
        query: z.object({ domainId: z.string().uuid() }),
        body: z.object({}),
    }), async ({ request, response, input }) => {
        const identity = request.identity;
        if (!identity) {
            response.status(401).json({ error: "Not authenticated" });
            return;
        }
        console.log("[api] GET /webhooks", input.query);
        response.json({ webhooks: [] });
    }));
    // DELETE /webhooks/:id — delete a webhook endpoint
    r.delete("/webhooks/:id", typedRoute(z.object({
        params: z.object({ id: z.string().uuid() }),
        query: z.object({}),
        body: z.object({}),
    }), async ({ input, request, response }) => {
        const identity = request.identity;
        if (!identity) {
            response.status(401).json({ error: "Not authenticated" });
            return;
        }
        console.log("[api] DELETE /webhooks", input.params);
        response.json({ deleted: true });
    }));
    // POST /hooks/:domainId/:endpointId — test/trigger webhook delivery (no auth, external call)
    r.post("/hooks/:domainId/:endpointId", typedRoute(z.object({
        params: z.object({ domainId: z.string().uuid(), endpointId: z.string().uuid() }),
        query: z.object({}),
        body: z.unknown(),
    }), async ({ input, response }) => {
        console.log("[api] POST /hooks", input.params);
        response.json({ delivered: true });
    }));
}
//# sourceMappingURL=webhook-handler.js.map