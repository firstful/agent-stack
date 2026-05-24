/**
 * domain-resolver.ts — multi-tenant domain resolution for the SaaS runtime.
 *
 * Resolves the current domain from the Host header or API key before
 * core route handlers execute.  In self-hosted mode this is replaced by
 * a fixed single-domain middleware.
 */
/**
 * resolveDomainFromHost — looks up the domain record for a given hostname.
 * Returns null if the domain is unknown or suspended.
 */
async function resolveDomainFromHost(hostname) {
    // TODO: query domains table where name = hostname
    //       check suspended_at, handle custom domains, www-prefix stripping, etc.
    return null;
}
/**
 * resolveDomainFromApiKey — looks up the domain via an API key token.
 */
async function resolveDomainFromApiKey(apiKey) {
    // TODO: query api_keys table, join to domain
    return null;
}
/**
 * domainResolver — Express middleware that injects req.domain.
 * Responds 404 for unknown domains and 401 for invalid API keys.
 */
export function domainResolver(req, res, next) {
    const host = req.hostname;
    const apiKey = req.headers["x-api-key"];
    (async () => {
        let domain = null;
        if (apiKey) {
            domain = await resolveDomainFromApiKey(apiKey);
        }
        if (!domain && host) {
            domain = await resolveDomainFromHost(host);
        }
        if (!domain) {
            res.status(404).json({ error: "Unknown domain" });
            return;
        }
        req.domain = domain;
        next();
    })();
}
//# sourceMappingURL=domain-resolver.js.map