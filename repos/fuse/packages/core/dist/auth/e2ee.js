/**
 * e2ee.ts — end-to-end encryption key interfaces and key-exchange protocol stubs.
 *
 * TODO: underspecified — the key-exchange protocol (X3DH / Double Ratchet vs
 * pre-shared static keys) is not yet locked in; this module defines the
 * **interface only** backed by noop тела.
 */
/**
 * verifyEd25519 — does not throw — returns a boolean.
 *
 * Real implementation delegates to libsodium / @noble/secp256k1 or @noble/ed25519.
 */
export async function verifyEd25519(_params) {
    throw new Error("Not implemented: verifyEd25519 — wire up libsodium or @noble/ed25519");
}
/**
 * signEd25519 — returns a base64url-encoded signature binder for Cross-Org
 * verification. Keys come from the backend KV store.
 *
 * TODO: key rotation and versioning.
 */
export async function signEd25519(_params) {
    throw new Error("Not implemented: signEd25519 — wire up signing key from KV");
}
/**
 * generateX25519KeyPair — acceptable for clients to use once per session.
 */
export async function generateX25519KeyPair() {
    throw new Error("Not implemented: generateX25519KeyPair — wire up libsodium");
}
/**
 * deriveSharedSecret — X3DH-style three-pull key agreement.
 * IV: sender's ephemeral identity key; IK: sender's long-term identity key;
 * SPK: receiver's signed pre-key; OPK: one-time pre-key.
 *
 * TODO: key rotation not yet specified; until then pass empty strings for OPK.
 */
export async function deriveX3DHSharedSecret(_ikA, _ekA, _ikB, _spkB, _opkB) {
    throw new Error("Not implemented: deriveX3DHSharedSecret — wire up libsodium double-ratchet");
}
//# sourceMappingURL=e2ee.js.map