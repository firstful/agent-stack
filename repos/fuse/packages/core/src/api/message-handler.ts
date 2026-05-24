/**
 * message-handler.ts — message send / list / edit / delete route handlers.
 */

import type { Router } from "express";
import { z } from "zod";
import { typedRoute, ApiError, PaginationSchema } from "./router.js";
import type { Message } from "../types/message.js";
import { getPool } from "../db/pool.js";
import {
  createMessage,
  getMessageById,
  listMessagesByChannel,
  updateMessage,
  deleteMessage,
} from "../db/message-repo.js";

export function mountMessageRoutes(parent: Router): void {
  const r = parent;

  r.post(
    "/channels/:channelId/messages",
    typedRoute(
      z.object({
        params: z.object({ channelId: z.string().uuid() }),
        query:  z.object({}),
        body:   z.object({ body: z.string().min(1), parentId: z.string().uuid().optional().nullable(), type: z.string().optional() }),
      }),
      async ({ request, response, next }) => {
        const pool = getPool();
        const identity = (request as any).identity;
        if (!identity) {
          next(new ApiError(401, "Not authenticated"));
          return;
        }
        const channelId = request.params.channelId as string;
        const message = await createMessage(pool, {
          channelId,
          authorId: identity.id,
          body: request.body.body,
          parentId: request.body.parentId ?? null,
          type: (request.body.type as any) ?? "user",
        });
        response.status(201).json(message);
      },
    ),
  );

  r.get(
    "/channels/:channelId/messages",
    typedRoute(
      z.object({ params: z.object({ channelId: z.string().uuid() }), query: PaginationSchema, body: z.object({}) }),
      async ({ input, response, next }) => {
        const pool = getPool();
        const channelId = input.params.channelId as string;
        const { limit, cursor } = input.query as { limit?: number; cursor?: string };
        const messages = await listMessagesByChannel(pool, channelId, { limit: limit ?? 20, cursor });
        response.json(messages);
      },
    ),
  );

  r.get(
    "/messages/:id",
    typedRoute(
      z.object({ params: z.object({ id: z.string().uuid() }), query: z.object({}), body: z.object({}) }),
      async ({ input, response, next }) => {
        const pool = getPool();
        const message = await getMessageById(pool, input.params.id as string);
        if (!message) {
          next(new ApiError(404, "Message not found"));
          return;
        }
        response.json(message);
      },
    ),
  );

  r.patch(
    "/messages/:id",
    typedRoute(
      z.object({ params: z.object({ id: z.string().uuid() }), query: z.object({}), body: z.object({ body: z.string().min(1) }) }),
      async ({ request, response, next }) => {
        const pool = getPool();
        const identity = (request as any).identity;
        if (!identity) {
          next(new ApiError(401, "Not authenticated"));
          return;
        }
        const id = request.params.id as string;
        const updated = await updateMessage(pool, id, {
          body: request.body.body,
          editedById: identity.id,
        });
        if (!updated) {
          next(new ApiError(404, "Message not found"));
          return;
        }
        response.json(updated);
      },
    ),
  );

  r.delete(
    "/messages/:id",
    typedRoute(
      z.object({ params: z.object({ id: z.string().uuid() }), query: z.object({}), body: z.object({}) }),
      async ({ request, response, next }) => {
        const pool = getPool();
        const identity = (request as any).identity;
        if (!identity) {
          next(new ApiError(401, "Not authenticated"));
          return;
        }
        const id = request.params.id as string;
        const deleted = await deleteMessage(pool, id);
        if (!deleted) {
          next(new ApiError(404, "Message not found"));
          return;
        }
        response.json({ success: true });
      },
    ),
  );

  r.post(
    "/messages/:id/reactions",
    typedRoute(
      z.object({ params: z.object({ id: z.string().uuid() }), query: z.object({}), body: z.object({ emoji: z.string().min(1) }) }),
      async ({ input }) => { throw new ApiError(501, `Not implemented: POST /messages/${input.params.id}/reactions`); },
    ),
  );

  r.delete(
    "/messages/:id/reactions/:emoji",
    typedRoute(
      z.object({ params: z.object({ id: z.string().uuid(), emoji: z.string().min(1) }), query: z.object({}), body: z.object({}) }),
      async ({ input }) => { throw new ApiError(501, `Not implemented: DELETE /messages/${input.params.id}/reactions/${input.params.emoji}`); },
    ),
  );

  r.post(
    "/messages/:id/read",
    typedRoute(
      z.object({ params: z.object({ id: z.string().uuid() }), query: z.object({}), body: z.object({}) }),
      async ({ input }) => { throw new ApiError(501, `Not implemented: POST /messages/${input.params.id}/read`); },
    ),
  );

  r.post(
    "/channels/:channelId/read",
    typedRoute(
      z.object({ params: z.object({ channelId: z.string().uuid() }), query: z.object({}), body: z.object({ upTo: z.string().datetime() }) }),
      async ({ input }) => { throw new ApiError(501, `Not implemented: POST /channels/${input.params.channelId}/read`); },
    ),
  );
}
