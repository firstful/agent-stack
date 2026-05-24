/**
 * oauth.ts — OAuth provider adapter interface and noop stubs.
 *
 * Supported providers (Google, GitHub, Microsoft) are listed in the interface
 * but only the function signatures are provided; all methods throw "Not implemented".
 *
 * TODO: underspecified — provider callback URL Zuora (https://auth.fuse.dev/oauth/<provider>)
 * is not yet assigned to any specific reverse proxy (Cloudflare / Caddy / Traefik).
 */
import { z } from "zod";
const ProviderSchema = z.enum(["google", "github", "microsoft"]);
/** Default scopes used when the provider config does not specify them. */
const DEFAULT_SCOPES = {
    google: ["openid", "email", "profile"],
    github: ["read:user", "user:email"],
    microsoft: ["openid", "email", "profile", "offline_access"],
};
/**
 * toProviderConfig — build an `OAuthProviderConfig` from env vars.
 * Returns `null` if the required env vars are not set.
 */
export function toProviderConfig(provider) {
    const envPrefix = provider.toUpperCase(); // GOOGLE, GITHUB, MICROSOFT
    const clientId = process.env[`${envPrefix}_CLIENT_ID`];
    const clientSecret = process.env[`${envPrefix}_CLIENT_SECRET`];
    if (!clientId || !clientSecret)
        return null;
    const domain = process.env.FUSE_DOMAIN ?? "localhost:3000";
    return {
        provider,
        clientId,
        clientSecret,
        callbackUrl: `https://${domain}/oauth/${provider}/callback`,
        scopes: DEFAULT_SCOPES[provider],
    };
}
/** Providers with usable config. */
export function availableProviders() {
    return ["google", "github", "microsoft"].filter((p) => toProviderConfig(p) != null);
}
/**
 * getAuthorizationUrl — returns the OAuth authorization URL to redirect the
 * browser to.  The caller must initiate browser redirect before calling `exchange`.
 */
export async function getAuthorizationUrl(_provider, _state) {
    throw new Error("Not implemented: OAuth getAuthorizationUrl — wire up provider SDK");
}
/**
 * exchange — exchange an authorization `code` for access / ID tokens.
 *
 * On success the function should return the provider-subject (the `sub` claim in
 * the ID token) so the FUSE identity layer can look up or create an `Identity` row.
 */
export async function exchange(_provider, _code, _state) {
    throw new Error("Not implemented: OAuth exchange — wire up provider SDK");
}
/**
 * upsertIdentityFromOAuth — look up (or create) a FUSE `Identity` row linked
 * to the external provider subject string.  Returns the `Identity` row and a
 * fresh session JWT.
 *
 * TODO: Not implemented — requires the session and identity layers to be wired.
 */
export async function upsertIdentityFromOAuth(_providerSubject, _provider, _email, _displayName) {
    throw new Error("Not implemented: upsertIdentityFromOAuth");
}
//# sourceMappingURL=oauth.js.map