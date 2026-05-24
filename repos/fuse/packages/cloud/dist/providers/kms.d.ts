/**
 * providers/kms.ts — key management provider adapters.
 *
 * Server-side identity keys (for shared/agent/service identities in S2EE
 * channels) are stored in the configured KMS rather than on disk.
 */
import type { KmsProvider } from "./index.js";
export declare function createKmsProvider(providerName: string): KmsProvider;
//# sourceMappingURL=kms.d.ts.map