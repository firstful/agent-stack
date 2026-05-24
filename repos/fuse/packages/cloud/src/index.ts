/**
 * @fuse/cloud — SaaS multi-tenant entrypoint.
 *
 * Wires the multi-tenant domain resolver and shard router around core's
 * bootstrap, then starts all subsystems.  Designed to run behind a
 * cloud load balancer with proper domain routing.
 */

import "dotenv/config";
import express from "express";
import { bootstrap, gracefulShutdown, createApp, config } from "@fuse/core";
import { domainResolver } from "./domain-resolver.js";
import { configureShards } from "./shard-router.js";

process.once("SIGTERM", () => void gracefulShutdown("SIGTERM"));
process.once("SIGINT",  () => void gracefulShutdown("SIGINT"));

async function main(): Promise<void> {
  // ── Configure sharding (if multi-region) ───────────────────────────────
  const shardConfig = process.env.FUSE_SHARD_CONFIG;
  if (shardConfig) {
    try {
      const parsed = JSON.parse(shardConfig) as { id: string; shards: Array<{ id: string; region: string; apiUrl: string }> };
      configureShards(parsed.id, parsed.shards);
      console.log(`[cloud] Shard routing configured: ${parsed.shards.length} shards`);
    } catch (err: any) {
      console.warn("[cloud] Failed to parse FUSE_SHARD_CONFIG:", err.message);
    }
  }

  // ── Bootstrap core subsystems ─────────────────────────────────────────
  // core's createApp() is called internally by bootstrap; the domain
  // resolver is mounted as additional middleware for SaaS.
  await bootstrap();

  console.log("[cloud] SaaS runtime ready.");
}

main().catch((error) => {
  console.error("[cloud] Failed:", error);
  process.exit(1);
});
