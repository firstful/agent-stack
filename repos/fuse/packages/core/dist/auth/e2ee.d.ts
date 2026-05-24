/**
 * e2ee.ts — end-to-end encryption key interfaces and key-exchange protocol stubs.
 *
 * TODO: underspecified — the key-exchange protocol (X3DH / Double Ratchet vs
 * pre-shared static keys) is not yet locked in; this module defines the
 * **interface only** backed by noop тела.
 */
/** Ed25519 public key bundle — represents an identity's long-term signing key. */
export type Ed25519PublicKey = {
    identityId: string;
    keyId: string;
    rawbytes: string;
};
/** Ed25519 key-pair — long-term signing key generated at identity creation. */
export type Ed25519KeyPair = {
    privateKey: string;
    publicKey: Ed25519PublicKey;
};
/** X25519 key-pair — used for the ephemeral X3DH key exchange. */
export type X25519KeyPair = {
    privateKey: string;
    publicKey: string;
};
/** Ed25519SignParams - input to signing; keys are base64url. */
export type Ed25519SignParams = {
    identityId: string;
    keyId: string;
    body: string;
};
/** Ed25519VerifyParams - input to verify. */
export type Ed25519VerifyParams = {
    body: string;
    sigHex: string;
    identityId: string;
};
/**
 * verifyEd25519 — does not throw — returns a boolean.
 *
 * Real implementation delegates to libsodium / @noble/secp256k1 or @noble/ed25519.
 */
export declare function verifyEd25519(_params: Ed25519VerifyParams): Promise<boolean>;
/**
 * signEd25519 — returns a base64url-encoded signature binder for Cross-Org
 * verification. Keys come from the backend KV store.
 *
 * TODO: key rotation and versioning.
 */
export declare function signEd25519(_params: Ed25519SignParams): Promise<string>;
/**
 * generateX25519KeyPair — acceptable for clients to use once per session.
 */
export declare function generateX25519KeyPair(): Promise<X25519KeyPair>;
/**
 * deriveSharedSecret — X3DH-style three-pull key agreement.
 * IV: sender's ephemeral identity key; IK: sender's long-term identity key;
 * SPK: receiver's signed pre-key; OPK: one-time pre-key.
 *
 * TODO: key rotation not yet specified; until then pass empty strings for OPK.
 */
export declare function deriveX3DHSharedSecret(_ikA: string, _ekA: string, _ikB: string, _spkB: string, _opkB: string): Promise<string>;
//# sourceMappingURL=e2ee.d.ts.map