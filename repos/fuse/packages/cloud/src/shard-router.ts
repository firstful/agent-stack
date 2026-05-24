/**
 * shard-router.ts — domain-based shard routing for multi-region deployments.
 *
 * Resolves which shard owns a given domain and proxies the request there
 * via the federation webhook protocol.  Reuses the same Ed25519-signed
 * delivery mechanism that cross-org federation uses — no new transport.
 */

import type { Request, Response, NextFunction } from "express";

export interface ShardInfo {
  id: string;
  region: string;
  apiUrl: string;
}

/**
 * ShardMap — static mapping of domain_id → shard.
 * In production this would be a config file, env vars, or a registry.
 */
const shardMap = new Map<string, ShardInfo>();

let localShardId: string | null = null;

export function configureShards(localId: string, shards: ShardInfo[]): void {
  localShardId = localId;
  for (const shard of shards) {
    shardMap.set(shard.id, shard);
  }
}

export function setDomainShard(domainId: string, shardId: string): void {
  const shard = shardMap.get(shardId);
  if (!shard) throw new Error(`Unknown shard: ${shardId}`);
  shardMap.set(domainId, shard);
}

/**
 * shardRouter — Express middleware that proxies to the correct shard.
 * If the domain lives on the local shard, passes through to core routes.
 */
export function shardRouter(req: Request, res: Response, next: NextFunction): void {
  const domain = (req as any).domain as { id: string } | undefined;
  if (!domain) {
    next();
    return;
  }

  const shard = shardMap.get(domain.id);
  if (!shard || shard.id === localShardId) {
    next();
    return;
  }

  // TODO: proxy request to shard.apiUrl via federation webhook
  res.status(502).json({ error: "Cross-shard proxying not yet implemented" });
}
