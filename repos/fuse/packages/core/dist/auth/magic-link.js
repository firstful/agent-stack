/**
 * magic-link.ts — magic-link (passwordless) authentication stubs.
 *
 * Instead of requiring crypto / email transport deps at skeleton stage, this
 * module provides the full interface and throws "Not implemented" from every
 * stub.  Real production code should replace these with t.nonce + Ed25519-signed
 * tokens and a real SMTP send.
 */
import { z } from "zod";
/** Maximum TTL for a magic-link token, controlled by MAGIC_LINK_TOKEN_TTL env. */
const TOKEN_TTL = Number(process.env.MAGIC_LINK_TOKEN_TTL ?? 86_400); // 24 h
const MagicLinkTokenSchema = z.object({
    token: z.string().min(1),
    expiresAt: z.number().int().positive(),
    handle: z.string().min(1),
    domainId: z.string().uuid(),
});
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
export async function generateMagicLinkToken(handle, domainId, email) {
    if (!handle || !domainId)
        throw new Error("generateMagicLinkToken: handle and domainId are required");
    // Stub — uses random bytes instead of a real Ed25519 signature chain.
    throw new Error("Not implemented: generateMagicLinkToken — wire up Ed25519 signing");
}
/**
 * deliverMagicLink — send the login URL to the user's email address.
 *
 * The email body includes the `magic-link` URL with `?token=…` and expiry.
 *
 * TODO: Not implemented — attach a real SMTP library (nodemailer / smtp-client);
 * the stub logs the URL with console.log.
 */
export async function deliverMagicLink(email, token) {
    if (!email)
        throw new Error("deliverMagicLink: email is required");
    const magicUrl = `https://${process.env.FUSE_DOMAIN ?? "localhost:3000"}/auth/magic-link/${token.token}`;
    console.log(`[auth:magic-link] Would send to ${email}: ${magicUrl} (expires ${new Date(token.expiresAt * 1_000).toISOString()})`);
    throw new Error("Not implemented: deliverMagicLink — wire up SMTP transport");
}
/**
 * verifyMagicLinkToken — validate a token presented at the login endpoint.
 * Returns the embedded handle + domainId, or null if invalid.
 *
 * TODO: Not implemented — currently a stub that returns null for all inputs.
 */
export async function verifyMagicLinkToken(_token, _domainId, _handle) {
    throw new Error("Not implemented: verifyMagicLinkToken — implement Ed25519 verification");
}
//# sourceMappingURL=magic-link.js.map