/**
 * discovery.ts — DNS _fuse TXT record lookup noop stub.
 *
 * Skeleton-inferred intent:
 * The FUSE federation protocol uses DNSoverHTTPS (usually DoH) to look up
 * `_fuse.${domain}` TXT records, which contain the canonical webhook URL,
 * Ed25519 verification key fingerprint, preferred transport, and supported
 * capabilities.  This stub resolves the record via a DoH provider (Cloudflare
 * or Google) and returns a typed record.
 *
 * TODO: underspecified — prefer DoH vs plain DNS is policy that will be set
 * by DomainConfig.discoveryMode not yet defined.  This stub uses Cloudflare DoH
 * as the default target.
 */
/**
 * discoverPeerDomain — look up `_fuse.${domain}` TXT records via DoH and parse
 * them into a typed `DnsRecord` array.
 *
 * @param domain  The peer domain (e.g. `"example.corp"`).
 * @returns       Array of parsed TXT records.
 * @throws        If no `_fuse` TXT record is found the peer is not FUSE-capable.
 */
export declare function discoverPeerDomain(domain: string): Promise<import("../types/domain.js").DnsRecord[]>;
/**
 * validateDnsRecords — validates a set of `DnsRecord` entries and returns the
 * first one matching a preferred label (normally `_fuse.webhook`).
 *
 * Returns null when no matching label is found.
 */
export declare function validateDnsRecords(_records: import("../types/domain.js").DnsRecord[], _preferredLabel?: string): import("../types/domain.js").DnsRecord | null;
//# sourceMappingURL=discovery.d.ts.map