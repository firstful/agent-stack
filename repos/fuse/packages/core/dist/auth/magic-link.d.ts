/**
 * magic-link.ts — magic-link (passwordless) authentication stubs.
 *
 * Instead of requiring crypto / email transport deps at skeleton stage, this
 * module provides the full interface and throws "Not implemented" from every
 * stub.  Real production code should replace these with t.nonce + Ed25519-signed
 * tokens and a real SMTP send.
 */
/**
 * MagicLinkToken — the signed, time-limited token embedded in the magic-link URL.
 */
export type MagicLinkToken = {
    /** Base64url-decoded token string, returned to caller for URL embedding. */
    token: string;
    /** Unix timestamp after which the token is invalid. */
    expiresAt: number;
    /** The identity handle this token authenticates. */
    handle: string;
    /** The domain this token is scoped to. */
    domainId: string;
};
/**
 * generateMagicLinkToken — create a signed magic-link token.
 *
 * TODO: Not implemented — currently returns a random bytes dummy token; replace
 * with Ed25519-signed JWT before production.
 *
 * @param handle   Identity handle.
 * @param domainId Domain UUID.
 * @returns        MagicLinkToken suitable for embedding in a URL.
 */
export declare function generateMagicLinkToken(handle: string, domainId: string, email: string): Promise<MagicLinkToken>;
/**
 * deliverMagicLink — send the login URL to the user's email address.
 *
 * The email body includes the `magic-link` URL with `?token=…` and expiry.
 *
 * TODO: Not implemented — attach a real SMTP library (nodemailer / smtp-client);
 * the stub logs the URL with console.log.
 */
export declare function deliverMagicLink(email: string, token: MagicLinkToken): Promise<string>;
/**
 * verifyMagicLinkToken — validate a token presented at the login endpoint.
 * Returns the embedded handle + domainId, or null if invalid.
 *
 * TODO: Not implemented — currently a stub that returns null for all inputs.
 */
export declare function verifyMagicLinkToken(_token: string, _domainId: string, _handle: string): Promise<MagicLinkToken | null>;
//# sourceMappingURL=magic-link.d.ts.map