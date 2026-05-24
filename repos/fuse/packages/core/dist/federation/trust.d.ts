/**
 * trust.ts — TrustLevel scoring engine — noop stub.
 *
 * Skeleton-inferred intent:
 * The trust score for a peer domain is a weighted sum of signal categories:
 *
 *   - "dns_verified"   (2 pts)  — _fuse TXT record found
 *   - "spf_passes"     (2 pts)  — Maddy accepted a message from peer IP
 *   - "peer_emails"    (2 pts)  — ≥ 3 known identities have exchanged mail with the peer
 *   - "certs_valid"    (1 pt)   — ECDSA certificate on peer webhook endpoint valid
 *   - "warnings"       (−1 pt)  — any open abuse/complaint tickets
 *   - "bans"           (auto-0) — peer is in the blocklist
 *
 * Final TrustLevel is determined by buckets:
 *   score ≤ -1        → 0 (banned)
 *   score = 0         → 1 (read-only / passive)
 *   score = 1–3       → 2 (basic two-way message exchange)
 *   score = 4–6       → 3 (rich interaction)
 *   score = 7–10      → 4 (full trust)
 *
 * TODO: Not implemented — concrete signal sources and the permission table are TBD.
 */
import type { TrustLevel } from "../types/domain.js";
/**
 * trustLevelForDomain — compute a TrustLevel for a peer domain from whatever
 * signals are currently available.
 *
 * @throws Error if no signals are yet populated (i.e. the domain is entirely unknown).
 */
export declare function trustLevelForDomain(_peerDomain: string, _signals: Record<string, unknown>): Promise<TrustLevel>;
/**
 * isPeerTrusted — convenience guard: returns true only when trustLevel ≥ 2.
 * All lower levels are considered untrusted and their messages are discarded or
 * put in a quote-only queue for manual review.
 */
export declare function isPeerTrusted(_peerDomain: string): Promise<boolean>;
/**
 * adjustTrust — apply a delta (+/-) to an existing trust score and write to the
 * `trust_audit_log` (v2 migration concept).
 */
export declare function adjustTrust(_peerDomain: string, _reason: string, _through: "auto" | "manual" | "override"): Promise<TrustLevel>;
//# sourceMappingURL=trust.d.ts.map