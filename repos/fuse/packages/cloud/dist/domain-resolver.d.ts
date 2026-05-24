/**
 * domain-resolver.ts — multi-tenant domain resolution for the SaaS runtime.
 *
 * Resolves the current domain from the Host header or API key before
 * core route handlers execute.  In self-hosted mode this is replaced by
 * a fixed single-domain middleware.
 */
import type { Request, Response, NextFunction } from "express";
export interface ResolvedDomain {
    id: string;
    name: string;
    config: Record<string, unknown>;
}
/**
 * domainResolver — Express middleware that injects req.domain.
 * Responds 404 for unknown domains and 401 for invalid API keys.
 */
export declare function domainResolver(req: Request, res: Response, next: NextFunction): void;
//# sourceMappingURL=domain-resolver.d.ts.map