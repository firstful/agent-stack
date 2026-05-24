/**
 * providers/kms.ts — key management provider adapters.
 *
 * Server-side identity keys (for shared/agent/service identities in S2EE
 * channels) are stored in the configured KMS rather than on disk.
 */
// ── Local / noop (development only) ──────────────────────────────────────
class LocalKmsProvider {
    async encrypt(plaintext) {
        return plaintext; // no-op for dev
    }
    async decrypt(ciphertext) {
        return ciphertext; // no-op for dev
    }
}
// ── Factory ──────────────────────────────────────────────────────────────
export function createKmsProvider(providerName) {
    switch (providerName) {
        case "aws-kms":
        case "gcp-cloudkms":
        case "azure-keyvault":
        // TODO: implement native SDK adapters
        default:
            return new LocalKmsProvider();
    }
}
//# sourceMappingURL=kms.js.map