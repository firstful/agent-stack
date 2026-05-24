import { z } from "zod";
import { typedRoute, ApiError } from "./router.js";
import { getPool } from "../db/pool.js";
import { createPage, getPageBySlug, updatePage, insertBlock, updateBlock, deleteBlock, getPageById, } from "../db/document-repo.js";
const STATUS_OK = { status: "document-handler active" };
const BLOCK_TYPE_VALUES = [
    "paragraph", "heading", "heading2", "heading3", "bulletList", "orderedList",
    "taskList", "codeBlock", "blockQuote", "divider", "image", "file", "mention",
    "channelLink", "meetingNote", "adr", "postmortem", "okr", "embed", "reactionBar", "table",
];
function isBlockType(v) {
    return BLOCK_TYPE_VALUES.includes(v);
}
export function mountDocumentRoutes(parent) {
    const r = parent;
    r.get("/docs/status", (_req, res) => res.json(STATUS_OK));
    r.post("/channels/:channelId/pages", typedRoute(z.object({
        params: z.object({ channelId: z.string().uuid() }),
        query: z.object({}),
        body: z.object({
            slug: z.string().min(1),
            title: z.string().min(1),
            labels: z.array(z.string()).optional(),
        }),
    }), async ({ input, request, response, next }) => {
        const identity = request.identity;
        if (!identity) {
            next(new ApiError(401, "Not authenticated"));
            return;
        }
        const pool = getPool();
        const page = await createPage(pool, {
            id: crypto.randomUUID(),
            channelId: input.params.channelId,
            createdById: identity.id,
            slug: input.body.slug,
            title: input.body.title,
            archived: false,
            locked: false,
            rootBlockId: null,
            blocks: [],
            labels: input.body.labels ?? [],
            config: {},
            createdAt: new Date(),
            updatedAt: null,
        });
        response.status(201).json(page);
    }));
    r.get("/channels/:channelId/pages/:slug", typedRoute(z.object({
        params: z.object({ channelId: z.string().uuid(), slug: z.string().min(1) }),
        query: z.object({}),
        body: z.object({}),
    }), async ({ input, response, next }) => {
        const pool = getPool();
        const page = await getPageBySlug(pool, input.params.channelId, input.params.slug);
        if (page === null) {
            next(new ApiError(404, "Page not found"));
            return;
        }
        response.json(page);
    }));
    r.patch("/pages/:id", typedRoute(z.object({
        params: z.object({ id: z.string().uuid() }),
        query: z.object({}),
        body: z.object({
            title: z.string().min(1).optional(),
            slug: z.string().min(1).optional(),
            archived: z.boolean().optional(),
            locked: z.boolean().optional(),
            labels: z.array(z.string()).optional(),
            config: z.record(z.string(), z.unknown()).optional(),
        }),
    }), async ({ input, request, response, next }) => {
        const identity = request.identity;
        if (!identity) {
            next(new ApiError(401, "Not authenticated"));
            return;
        }
        const pool = getPool();
        const updated = await updatePage(pool, input.params.id, input.body);
        if (updated === null) {
            next(new ApiError(404, "Page not found"));
            return;
        }
        response.json(updated);
    }));
    r.post("/pages/:id/blocks", typedRoute(z.object({
        params: z.object({ id: z.string().uuid() }),
        query: z.object({}),
        body: z.object({
            type: z.string(),
            content: z.string(),
            index: z.number().int().nonnegative().optional(),
            attributes: z.record(z.string(), z.unknown()).optional(),
        }),
    }), async ({ input, request, response, next }) => {
        const identity = request.identity;
        if (!identity) {
            next(new ApiError(401, "Not authenticated"));
            return;
        }
        if (!isBlockType(input.body.type)) {
            next(new ApiError(400, `Invalid block type: ${input.body.type}`));
            return;
        }
        const pool = getPool();
        const page = await getPageById(pool, input.params.id);
        if (page === null) {
            next(new ApiError(404, "Page not found"));
            return;
        }
        const block = await insertBlock(pool, input.params.id, {
            id: crypto.randomUUID(),
            pageId: input.params.id,
            index: input.body.index ?? 0,
            children: [],
            type: input.body.type,
            content: input.body.content,
            attributes: (input.body.attributes ?? {}),
            authorId: identity.id,
            createdAt: new Date(),
            updatedAt: null,
            deletedAt: null,
            yjsLogHash: null,
        });
        response.status(201).json(block);
    }));
    r.patch("/blocks/:id", typedRoute(z.object({
        params: z.object({ id: z.string().uuid() }),
        query: z.object({}),
        body: z.object({
            content: z.string().optional(),
            attributes: z.record(z.string(), z.unknown()).optional(),
            index: z.number().int().nonnegative().optional(),
        }),
    }), async ({ input, request, response, next }) => {
        const identity = request.identity;
        if (!identity) {
            next(new ApiError(401, "Not authenticated"));
            return;
        }
        const pool = getPool();
        const updated = await updateBlock(pool, input.params.id, input.body);
        if (updated === null) {
            next(new ApiError(404, "Block not found"));
            return;
        }
        response.json(updated);
    }));
    r.delete("/blocks/:id", typedRoute(z.object({
        params: z.object({ id: z.string().uuid() }),
        query: z.object({}),
        body: z.object({}),
    }), async ({ input, request, response, next }) => {
        const identity = request.identity;
        if (!identity) {
            next(new ApiError(401, "Not authenticated"));
            return;
        }
        const pool = getPool();
        const deleted = await deleteBlock(pool, input.params.id);
        if (!deleted) {
            next(new ApiError(404, "Block not found"));
            return;
        }
        response.json({ success: true });
    }));
    r.patch("/pages/:id/archive", typedRoute(z.object({
        params: z.object({ id: z.string().uuid() }),
        query: z.object({}),
        body: z.object({ archived: z.boolean() }),
    }), async ({ input, request, response, next }) => {
        const identity = request.identity;
        if (!identity) {
            next(new ApiError(401, "Not authenticated"));
            return;
        }
        const pool = getPool();
        const updated = await updatePage(pool, input.params.id, { archived: input.body.archived });
        if (updated === null) {
            next(new ApiError(404, "Page not found"));
            return;
        }
        response.json(updated);
    }));
}
//# sourceMappingURL=document-handler.js.map