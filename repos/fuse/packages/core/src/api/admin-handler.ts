/**
 * admin-handler.ts — domain admin dashboard route handlers (noop stubs).
 */

import type { Router } from "express";
import { z } from "zod";
import { typedRoute, ApiError } from "./router.js";

const STATUS_OK: { status: string } = { status: "admin-handler stubs active — not implemented" };

export function mountAdminRoutes(parent: Router): void {
  const r = parent;

  r.get("/admin/status", (_req, res) => res.json(STATUS_OK));

  // All admin routes are gated behind the admin-auth middleware; the middleware
  // itself lives in src/auth/middleware.ts so routes here remain thin stubs.

  r.get(
    "/admin/domains/:id/identities",
    typedRoute(
      z.object({ params: z.object({ id: z.string().uuid() }), query: z.object({}), body: z.object({}) }),
      async ({ input, request, response }) => {
        const identity = (request as any).identity;
        if (!identity) { response.status(401).json({ error: "Not authenticated" }); return; }
        console.log("[api] GET /admin/domains/:id/identities", input.params);
        response.json({ identities: [] });
      },
    ),
  );

  r.post(
    "/admin/domains/:id/invite",
    typedRoute(
      z.object({ params: z.object({ id: z.string().uuid() }), query: z.object({}), body: z.object({ email: z.string().email(), role: z.enum(["member","admin"]).default("member") }) }),
      async ({ input, request, response }) => {
        const identity = (request as any).identity;
        if (!identity) { response.status(401).json({ error: "Not authenticated" }); return; }
        console.log("[api] POST /admin/domains/:id/invite", input.body);
        response.json({ invited: true });
      },
    ),
  );

  r.post(
    "/admin/domains/:id/trust-evaluate",
    typedRoute(
      z.object({ params: z.object({ id: z.string().uuid() }), query: z.object({}), body: z.object({ peerDomain: z.string().min(1) }) }),
      async ({ input, request, response }) => {
        const identity = (request as any).identity;
        if (!identity) { response.status(401).json({ error: "Not authenticated" }); return; }
        console.log("[api] POST /admin/domains/:id/trust-evaluate", input.body);
        response.json({ trustLevel: "unknown" });
      },
    ),
  );

  r.get(
    "/admin/webhooks/deliveries",
    typedRoute(
      z.object({ params: z.object({}), query: z.object({ endpointId: z.string().uuid() }), body: z.object({}) }),
      async ({ input, request, response }) => {
        const identity = (request as any).identity;
        if (!identity) { response.status(401).json({ error: "Not authenticated" }); return; }
        console.log("[api] GET /admin/webhooks/deliveries", input.query);
        response.json({ deliveries: [] });
      },
    ),
  );
}
