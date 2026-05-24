import { z } from "zod";
import { typedRoute, ApiError } from "./router.js";
import { getPool } from "../db/pool.js";
import { createMeeting, getMeetingById, updateMeeting, } from "../db/meeting-repo.js";
const STATUS_OK = { status: "meeting-handler active" };
export function mountMeetingRoutes(parent) {
    const r = parent;
    r.get("/meetings/status", (_req, res) => res.json(STATUS_OK));
    r.post("/channels/:channelId/meetings", typedRoute(z.object({
        params: z.object({ channelId: z.string().uuid() }),
        query: z.object({}),
        body: z.object({
            title: z.string().min(1),
            scheduledAt: z.string().datetime().optional().nullable(),
        }),
    }), async ({ input, request, response, next }) => {
        const identity = request.identity;
        if (!identity) {
            next(new ApiError(401, "Not authenticated"));
            return;
        }
        const pool = getPool();
        const meeting = await createMeeting(pool, {
            channelId: input.params.channelId,
            createdById: identity.id,
            title: input.body.title,
            scheduledAt: input.body.scheduledAt ? new Date(input.body.scheduledAt) : null,
        });
        response.status(201).json(meeting);
    }));
    r.post("/meetings/:id/join", typedRoute(z.object({
        params: z.object({ id: z.string().uuid() }),
        query: z.object({}),
        body: z.object({
            role: z.enum(["host", "presenter", "guest", "observer"]).default("guest"),
        }),
    }), async ({ input, response }) => { console.log("[api] POST /meetings/:id/join", input.params); response.json({ token: "placeholder", roomName: "placeholder" }); }));
    r.post("/meetings/:id/start", typedRoute(z.object({ params: z.object({ id: z.string().uuid() }), query: z.object({}), body: z.object({}) }), async ({ input, response, next }) => {
        const pool = getPool();
        const meeting = await getMeetingById(pool, input.params.id);
        if (meeting === null) {
            next(new ApiError(404, "Meeting not found"));
            return;
        }
        const updated = await updateMeeting(pool, input.params.id, { state: "ringing" });
        response.json(updated);
    }));
    r.post("/meetings/:id/end", typedRoute(z.object({ params: z.object({ id: z.string().uuid() }), query: z.object({}), body: z.object({}) }), async ({ input, response, next }) => {
        const pool = getPool();
        const meeting = await getMeetingById(pool, input.params.id);
        if (meeting === null) {
            next(new ApiError(404, "Meeting not found"));
            return;
        }
        const updated = await updateMeeting(pool, input.params.id, { state: "ended", endedAt: new Date() });
        response.json(updated);
    }));
    r.post("/meetings/:id/record", typedRoute(z.object({ params: z.object({ id: z.string().uuid() }), query: z.object({}), body: z.object({}) }), async ({ input, response }) => { console.log("[api] POST /meetings/:id/record", input.params); response.json({ recording: true }); }));
}
//# sourceMappingURL=meeting-handler.js.map