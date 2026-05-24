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

import { resolve as dnsResolve } from "node:dns/promises";

const DEFAULT_DOH_SERVER = "https://cloudflare-dns.com/dns-query";

/**
 * discoverPeerDomain — look up `_fuse.${domain}` TXT records via DoH and parse
 * them into a typed `DnsRecord` array.
 *
 * @param domain  The peer domain (e.g. `"example.corp"`).
 * @returns       Array of parsed TXT records.
 * @throws        If no `_fuse` TXT record is found the peer is not FUSE-capable.
 */
export async function discoverPeerDomain(
   domain: string,
): Promise<import("../types/domain.js").DnsRecord[]> {
  console.log('[federation:discoverPeerDomain]', { domain });
  // TODO: Not implemented — implement DNS over HTTPS lookup.
  throw new Error(
    `Not implemented: discoverPeerDomain — wire up DoH (default=${DEFAULT_DOH_SERVER})`,
  );
}

/**
 * validateDnsRecords — validates a set of `DnsRecord` entries and returns the
 * first one matching a preferred label (normally `_fuse.webhook`).
 *
 * Returns null when no matching label is found.
 */
export function validateDnsRecords(
  _records: import("../types/domain.js").DnsRecord[],
  _preferredLabel: string = "_fuse.webhook",
): import("../types/domain.js").DnsRecord | null {
  console.log('[federation:validateDnsRecords]', { _records, _preferredLabel });
  // TODO: Not implemented — parse TXT RDATA format once the spec is finalised.
  throw new Error("Not implemented: validateDnsRecords");
}
