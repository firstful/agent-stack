/**
 * oauth.ts — OAuth provider adapter interface and noop stubs.
 *
 * Supported providers (Google, GitHub, Microsoft) are listed in the interface
 * but only the function signatures are provided; all methods throw "Not implemented".
 *
 * TODO: underspecified — provider callback URL Zuora (https://auth.fuse.dev/oauth/<provider>)
 * is not yet assigned to any specific reverse proxy (Cloudflare / Caddy / Traefik).
 */
import type { Identity } from "../types/identity.js";
/** Canonical provider identifiers. */
export type OAuthProvider = "google" | "github" | "microsoft";
/**
 * OAuthProviderConfig — per-provider client credentials and callback URLs.
 */
export type OAuthProviderConfig = {
    provider: OAuthProvider;
    clientId: string;
    clientSecret: string;
    /** OAuth `redirect_uri` registered with the provider. */
    callbackUrl: string;
    /** Optional scope override; defaults to `["openid","email","profile"]`. */
    scopes: string[];
};
/**
 * toProviderConfig — build an `OAuthProviderConfig` from env vars.
 * Returns `null` if the required env vars are not set.
 */
export declare function toProviderConfig(provider: OAuthProvider): OAuthProviderConfig | null;
/** Providers with usable config. */
export declare function availableProviders(): OAuthProvider[];
/**
 * getAuthorizationUrl — returns the OAuth authorization URL to redirect the
 * browser to.  The caller must initiate browser redirect before calling `exchange`.
 */
export declare function getAuthorizationUrl(_provider: OAuthProvider, _state: string): Promise<string>;
/**
 * exchange — exchange an authorization `code` for access / ID tokens.
 *
 * On success the function should return the provider-subject (the `sub` claim in
 * the ID token) so the FUSE identity layer can look up or create an `Identity` row.
 */
export declare function exchange(_provider: OAuthProvider, _code: string, _state: string): Promise<{
    providerSubject: string;
    email: string;
    displayName: string;
    rawTokens: Record<string, unknown>;
}>;
/**
 * upsertIdentityFromOAuth — look up (or create) a FUSE `Identity` row linked
 * to the external provider subject string.  Returns the `Identity` row and a
 * fresh session JWT.
 *
 * TODO: Not implemented — requires the session and identity layers to be wired.
 */
export declare function upsertIdentityFromOAuth(_providerSubject: string, _provider: OAuthProvider, _email: string, _displayName: string): Promise<{
    identity: Identity;
    sessionToken: string;
}>;
//# sourceMappingURL=oauth.d.ts.map