/**
 * domain-handler.ts — domain config / trust-level route handlers.
 */
import { z } from "zod";
import { typedRoute, ApiError } from "./router.js";
import { getPool } from "../db/pool.js";
import { createDomain, getDomainById, listDomains, updateDomain, setTrustLevel, } from "../db/domain-repo.js";
const STATUS_OK = { status: "domain-handler active" };
export function mountDomainRoutes(parent) {
    const r = parent;
    r.get("/domains/status", (_req, res) => res.json(STATUS_OK));
    r.get("/domains", typedRoute(z.object({ params: z.object({}), query: z.object({}), body: z.object({}) }), async ({ response }) => {
        const pool = getPool();
        const domains = await listDomains(pool);
        response.json(domains);
    }));
    r.post("/domains", typedRoute(z.object({
        params: z.object({}),
        query: z.object({}),
        body: z.object({ name: z.string().min(1), contactEmail: z.string().email() }),
    }), async ({ input, response }) => {
        const pool = getPool();
        const domain = await createDomain(pool, {
            name: input.body.name,
            contactEmail: input.body.contactEmail,
        });
        response.status(201).json(domain);
    }));
    r.get("/domains/:id", typedRoute(z.object({ params: z.object({ id: z.string().uuid() }), query: z.object({}), body: z.object({}) }), async ({ input, response, next }) => {
        const pool = getPool();
        const domain = await getDomainById(pool, input.params.id);
        if (domain === null) {
            next(new ApiError(404, `Domain not found: ${input.params.id}`));
            return;
        }
        response.json(domain);
    }));
    r.patch("/domains/:id/config", typedRoute(z.object({ params: z.object({ id: z.string().uuid() }), query: z.object({}), body: z.record(z.string(), z.unknown()) }), async ({ input, response, next }) => {
        const pool = getPool();
        const domain = await getDomainById(pool, input.params.id);
        if (domain === null) {
            next(new ApiError(404, `Domain not found: ${input.params.id}`));
            return;
        }
        // Define partial config schema for updates (all optional)
        const PartialConfigSchema = z.object({
            federationEnabled: z.boolean().optional(),
            defaultPeerTrustLevel: z.union([
                z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)
            ]).optional(),
            maxMessageSizeBytes: z.number().int().positive().optional(),
            sessionStrategy: z.enum(["cookie", "header", "jwt"]).optional(),
            ssoProvider: z.string().nullable().optional(),
            displayName: z.string().max(255).optional(),
            rateLimits: z.record(z.string(), z.number()).optional(),
            messageRetention: z.enum([
                "retain", "purge_after_hours", "purge_immediately"
            ]).optional(),
            metadata: z.record(z.string(), z.unknown()).optional(),
            updatedAt: z.coerce.date().optional(),
        });
        const parsed = PartialConfigSchema.parse(input.body);
        const newConfig = {
            ...domain.config,
            ...parsed,
            domainId: domain.id, // ensure domainId matches the domain
        };
        const updated = await updateDomain(pool, input.params.id, { config: newConfig });
        if (updated === null) {
            // Should not happen since we just fetched the domain
            next(new ApiError(404, `Domain not found: ${input.params.id}`));
            return;
        }
        response.json(updated);
    }));
    r.post("/domains/:id/trust-level", typedRoute(z.object({
        params: z.object({ id: z.string().uuid() }),
        query: z.object({}),
        body: z.object({ level: z.union([
                z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)
            ]) })
    }), async ({ input, response, next }) => {
        const pool = getPool();
        await setTrustLevel(pool, input.params.id, input.body.level);
        response.status(200).json({ success: true });
    }));
    r.post("/domains/:id/verify", typedRoute(z.object({ params: z.object({ id: z.string().uuid() }), query: z.object({}), body: z.object({}) }), async ({ input, response }) => {
        // Stub: just return success
        response.json({ success: true });
    }));
    r.get("/domains/:id/discovery", typedRoute(z.object({ params: z.object({ id: z.string().uuid() }), query: z.object({}), body: z.object({}) }), async ({ input, response, next }) => {
        const pool = getPool();
        const domain = await getDomainById(pool, input.params.id);
        if (domain === null) {
            next(new ApiError(404, `Domain not found: ${input.params.id}`));
            return;
        }
        response.json(domain);
    }));
}
//# sourceMappingURL=domain-handler.js.map