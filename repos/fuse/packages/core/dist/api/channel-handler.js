import { z } from "zod";
import { typedRoute, ApiError, PaginationSchema } from "./router.js";
import { getPool } from "../db/pool.js";
import { createChannel, getChannelById, updateChannel, deleteChannel, addMember, removeMember, } from "../db/channel-repo.js";
function isChannelType(v) {
    return ["public", "private", "dm", "group", "cross_org"].includes(v);
}
const STATUS_OK = { status: "channel-handler active" };
export function mountChannelRoutes(parent) {
    const r = parent;
    r.get("/channels/status", (_req, res) => res.json(STATUS_OK));
    r.post("/channels", typedRoute(z.object({ params: z.object({}), query: z.object({}), body: z.object({ name: z.string().min(1), type: z.string(), domainId: z.string().uuid() }) }), async ({ input, request, response, next }) => {
        const identity = request.identity;
        if (!identity) {
            next(new ApiError(401, "Not authenticated"));
            return;
        }
        const pool = getPool();
        const channel = await createChannel(pool, {
            name: input.body.name,
            type: input.body.type,
            domainId: input.body.domainId,
            smtpAddress: `#${input.body.name.toLowerCase().replace(/\s+/g, '-')}@${input.body.domainId}`,
            createdById: identity.id,
        });
        response.status(201).json(channel);
    }));
    r.get("/channels/:id", typedRoute(z.object({ params: z.object({ id: z.string().uuid() }), query: PaginationSchema, body: z.object({}) }), async ({ input, response, next }) => {
        const pool = getPool();
        const channel = await getChannelById(pool, input.params.id);
        if (!channel) {
            next(new ApiError(404, "Channel not found"));
            return;
        }
        response.json(channel);
    }));
    r.patch("/channels/:id", typedRoute(z.object({ params: z.object({ id: z.string().uuid() }), query: z.object({}), body: z.record(z.string(), z.unknown()) }), async ({ input, request, response, next }) => {
        const identity = request.identity;
        if (!identity) {
            next(new ApiError(401, "Not authenticated"));
            return;
        }
        const pool = getPool();
        const channel = await updateChannel(pool, input.params.id, input.body);
        if (!channel) {
            next(new ApiError(404, "Channel not found"));
            return;
        }
        response.json(channel);
    }));
    r.delete("/channels/:id", typedRoute(z.object({ params: z.object({ id: z.string().uuid() }), query: z.object({}), body: z.object({}) }), async ({ input, request, response, next }) => {
        const identity = request.identity;
        if (!identity) {
            next(new ApiError(401, "Not authenticated"));
            return;
        }
        const pool = getPool();
        const ok = await deleteChannel(pool, input.params.id);
        if (!ok) {
            next(new ApiError(404, "Channel not found"));
            return;
        }
        response.json({ success: true });
    }));
    r.post("/channels/:id/members", typedRoute(z.object({ params: z.object({ id: z.string().uuid() }), query: z.object({}), body: z.object({ identityId: z.string().uuid(), role: z.enum(["owner", "admin", "member", "guest"]).default("member") }) }), async ({ input, request, response, next }) => {
        const identity = request.identity;
        if (!identity) {
            next(new ApiError(401, "Not authenticated"));
            return;
        }
        const pool = getPool();
        const member = await addMember(pool, {
            channelId: input.params.id,
            identityId: input.body.identityId,
            role: input.body.role,
        });
        response.status(201).json(member);
    }));
    r.delete("/channels/:id/members/:identityId", typedRoute(z.object({ params: z.object({ id: z.string().uuid(), identityId: z.string().uuid() }), query: z.object({}), body: z.object({}) }), async ({ request, next, response }) => {
        const pool = getPool();
        const identity = request.identity;
        if (!identity) {
            next(new ApiError(401, "Not authenticated"));
            return;
        }
        const removed = await removeMember(pool, request.params.id, request.params.identityId);
        if (!removed) {
            next(new ApiError(404, "Membership not found"));
            return;
        }
        response.json({ success: true });
    }));
}
//# sourceMappingURL=channel-handler.js.map