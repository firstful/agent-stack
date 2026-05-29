/**
 * app.ts — Express app factory.
 *
 * Exporting the app as a factory function (rather than a singleton) makes
 * testing trivial: individual tests create an isolated app with stubbed
 * dependencies and an ephemeral DB.
 *
 * Mount order:
 *   helmet → cors → json/urlencoded body parsers → query string parser →
 *   auth middleware (from src/auth/) → API router (createApiRouter) →
 *   webui static files → SPA catch-all → error handler
 */

import type { Request, Response } from "express";
import type { HelmetOptions } from "helmet";
import path from "node:path";
import fs from "node:fs";
import cors from "cors";
import helmet from "helmet";
import express from "express";
import { authMiddleware } from "./auth/middleware.js";
import { createApiRouter, errorMiddleware } from "./api/router.js";
import { config } from "./config.js";

// Helmet config — tighten CSP in production; permissive in dev so that the
// root SPA / proxy UI development workflow does not conflict.
const helmetOptions: HelmetOptions = config.NODE_ENV === "production"
  ? {
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc:  ["'self'"],
          styleSrc:   ["'self'"],
          imgSrc:     ["'self'", "data:", "https:"],
          connectSrc: ["'self'", "ws:", "wss:"],
        },
      },
    }
  : {};

const WEBUI_DIR = path.resolve(process.cwd(), "packages/webui");

/**
 * createApp — builds and returns a fully wired Express application instance.
 * No route handlers are registered until `app` is called from `createApp`.
 */
export function createApp(): import("express").Express {
  const app = express();

  // ── Security headers ───────────────────────────────────────────────────
  app.use(helmet(helmetOptions));

  // ── CORS ───────────────────────────────────────────────────────────────
  app.use(cors({
    origin: config.NODE_ENV === "production"
      ? process.env.FUSE_DOMAIN
      : true,
    credentials: true,
    methods:  ["GET","POST","PUT","PATCH","DELETE","OPTIONS"],
    allowedHeaders: ["Content-Type","Authorization","X-Fuse-Session","X-Fuse-Signature","X-Fuse-Timestamp"],
  }));

  // ── Body parsers ───────────────────────────────────────────────────────
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true }));

  // ── Health check ───────────────────────────────────────────────────────
  app.get("/healthz", (_req: Request, res: Response) => {
    res.json({ status: "ok", environment: config.NODE_ENV });
  });

  // ── API routes ─────────────────────────────────────────────────────────
  const apiRouter = createApiRouter();
  app.use("/api/v1", authMiddleware, apiRouter);

  // ── Web UI static files ────────────────────────────────────────────────
  if (fs.existsSync(WEBUI_DIR)) {
    app.use(express.static(WEBUI_DIR));
    app.get("*", (_req: Request, res: Response) => {
      const indexPath = path.join(WEBUI_DIR, "index.html");
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).json({ error: "Not found" });
      }
    });
  }

  // ── Post-handler error collector ───────────────────────────────────────
  app.use(errorMiddleware);

  return app;
}

// (express imported at top level)
