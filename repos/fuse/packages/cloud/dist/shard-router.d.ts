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
export declare function configureShards(localId: string, shards: ShardInfo[]): void;
export declare function setDomainShard(domainId: string, shardId: string): void;
/**
 * shardRouter — Express middleware that proxies to the correct shard.
 * If the domain lives on the local shard, passes through to core routes.
 */
export declare function shardRouter(req: Request, res: Response, next: NextFunction): void;
//# sourceMappingURL=shard-router.d.ts.map