import { z } from "zod";
import { typedRoute, ApiError } from "./router.js";
import { getPool } from "../db/pool.js";
import { createIdentity, getIdentityById, getIdentityByHandle, updateIdentity, addIdentityKey, revokeIdentityKey, getIdentityKeys } from "../db/identity-repo.js";
import { getDomainByName } from "../db/domain-repo.js";
import { createSession } from "../auth/session.js";
const STATUS_OK = { status: "identity-handler active" };
export function mountIdentityRoutes(parent) {
    const r = parent;
    r.get("/auth/status", (_req, res) => res.json(STATUS_OK));
    r.post("/auth/register", typedRoute(z.object({
        params: z.object({}),
        query: z.object({}),
        body: z.object({
            domainName: z.string().min(1),
            handle: z.string().min(1).max(255),
            displayName: z.string().min(1).max(255),
            type: z.enum(["human", "agent", "shared", "service", "guest"]).default("human"),
        }),
    }), async ({ input, response, next }) => {
        const pool = getPool();
        const domain = await getDomainByName(pool, input.body.domainName);
        if (!domain) {
            next(new ApiError(404, `Domain not found: ${input.body.domainName}`));
            return;
        }
        const existing = await getIdentityByHandle(pool, domain.id, input.body.handle);
        if (existing) {
            next(new ApiError(409, `Handle already taken: ${input.body.handle}`));
            return;
        }
        const identity = await createIdentity(pool, {
            domainId: domain.id,
            displayName: input.body.displayName,
            handle: input.body.handle,
            type: input.body.type,
        });
        const token = await createSession(identity);
        response.status(201).json({ identity, token });
    }));
    r.post("/auth/login", typedRoute(z.object({
        params: z.object({}),
        query: z.object({}),
        body: z.object({
            domainName: z.string().min(1),
            handle: z.string().min(1),
            credential: z.string().min(1),
        }),
    }), async ({ input, response }) => { console.log("[api] POST /auth/login", input.body); response.json({ token: "placeholder", identityId: "placeholder" }); }));
    r.get("/auth/magic-link/:token", typedRoute(z.object({
        params: z.object({ token: z.string() }),
        query: z.object({}),
        body: z.object({}),
    }), async ({ input, response }) => { console.log("[api] GET /auth/magic-link", input.params); response.json({ token: "placeholder", identityId: "placeholder" }); }));
    r.get("/identities/me", typedRoute(z.object({ params: z.object({}), query: z.object({}), body: z.object({}) }), async ({ request, response, next }) => {
        const identity = request.identity;
        if (!identity) {
            next(new ApiError(401, "Not authenticated"));
            return;
        }
        const pool = getPool();
        const full = await getIdentityById(pool, identity.id);
        if (!full) {
            next(new ApiError(404, "Identity not found"));
            return;
        }
        response.json(full);
    }));
    r.patch("/identities/me", typedRoute(z.object({ params: z.object({}), query: z.object({}), body: z.record(z.string(), z.unknown()) }), async ({ input, request, response, next }) => {
        const identity = request.identity;
        if (!identity) {
            next(new ApiError(401, "Not authenticated"));
            return;
        }
        const pool = getPool();
        const updated = await updateIdentity(pool, identity.id, input.body);
        if (!updated) {
            next(new ApiError(404, "Identity not found"));
            return;
        }
        response.json(updated);
    }));
    r.post("/identities/me/keys", typedRoute(z.object({ params: z.object({}), query: z.object({}), body: z.object({ rawKey: z.string().length(64) }) }), async ({ input, request, response, next }) => {
        const identity = request.identity;
        if (!identity) {
            next(new ApiError(401, "Not authenticated"));
            return;
        }
        const pool = getPool();
        const key = await addIdentityKey(pool, {
            identityId: identity.id,
            fingerprint: input.body.rawKey.slice(0, 16),
            rawbytes: input.body.rawKey,
        });
        response.status(201).json(key);
    }));
    r.delete("/identities/me/keys/:fingerprint", typedRoute(z.object({ params: z.object({ fingerprint: z.string() }), query: z.object({}), body: z.object({}) }), async ({ input, request, response }) => {
        const identity = request.identity;
        if (!identity) {
            throw new ApiError(401, "Not authenticated");
        }
        const pool = getPool();
        const keys = await getIdentityKeys(pool, identity.id);
        const key = keys.find(k => k.fingerprint === input.params.fingerprint);
        if (!key) {
            throw new ApiError(404, "Key not found");
        }
        await revokeIdentityKey(pool, identity.id, input.params.fingerprint);
        response.json({ success: true });
    }));
    r.get("/identities/:id", typedRoute(z.object({ params: z.object({ id: z.string().uuid() }), query: z.object({}), body: z.object({}) }), async ({ input, response, next }) => {
        const pool = getPool();
        const identity = await getIdentityById(pool, input.params.id);
        if (!identity) {
            next(new ApiError(404, "Identity not found"));
            return;
        }
        response.json(identity);
    }));
}
//# sourceMappingURL=identity-handler.js.map