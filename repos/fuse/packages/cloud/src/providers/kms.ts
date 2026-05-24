/**
 * providers/kms.ts — key management provider adapters.
 *
 * Server-side identity keys (for shared/agent/service identities in S2EE
 * channels) are stored in the configured KMS rather than on disk.
 */

import type { KmsProvider } from "./index.js";

// ── Local / noop (development only) ──────────────────────────────────────

class LocalKmsProvider implements KmsProvider {
  async encrypt(plaintext: Buffer): Promise<Buffer> {
    return plaintext; // no-op for dev
  }

  async decrypt(ciphertext: Buffer): Promise<Buffer> {
    return ciphertext; // no-op for dev
  }
}

// ── Factory ──────────────────────────────────────────────────────────────

export function createKmsProvider(providerName: string): KmsProvider {
  switch (providerName) {
    case "aws-kms":
    case "gcp-cloudkms":
    case "azure-keyvault":
      // TODO: implement native SDK adapters
    default:
      return new LocalKmsProvider();
  }
}
