import { z } from "zod";

/**
 * TrustLevel — numeric trust tier used by the federation engine to decide which
 * operations to allow or require additional signature verification for.
 *
 * | Level | Description                                |
 * |-------|-------------------------------------------|
 * | 0     | Fully blocked (banned domain)              |
 * | 1     | Read-only / passive                        |
 * | 2     | Basic two-way message exchange             |
 * | 3     | Rich interaction (reactions, threads)      |
 * | 4     | Full trust (unrestricted admin operations) |
 */
export type TrustLevel = 0 | 1 | 2 | 3 | 4;

/**
 * DnsRecord — a single _fuse.<label>.TXT row returned from a peer domain.
 *
 * TODO: underspecified — the canonical TXT format is not yet finalised;
 * see docs/federation-protocol.md once the spec is published.
 */
export type DnsRecord = {
  /** The _fuse TXT label queried, without the domain suffix. */
  label: string;
  /** Raw RDATA string(s) returned by the DNS resolver. */
  rdata: string[];
  /** TTL in seconds as returned by the authoritative nameserver. */
  ttl: number;
  /** The host that owns this record. */
  domainId: string;
};

/**
 * DomainConfig — per-domain runtime configuration that domain admins can
 * manipulate without code deploys.
 *
 * TODO: underspecified — many keys here (sso, retention, quota, rate-limit)
 * are placeholders whose exact schema will depend on the admin UI.
 */
export type DomainConfig = {
  domainId: string;
  /** Whether federation with external domains is permitted for this domain. */
  federationEnabled: boolean;
  /** Default trust level for inbound, unverified peer domains. */
  defaultPeerTrustLevel: TrustLevel;
  /** Maximum SMTP message size in bytes accepted by this domain. */
  maxMessageSizeBytes: number;
  /** Strategy used for multi-device session management. */
  sessionStrategy: "cookie" | "header" | "jwt";
  /** Single sign-on CNAME / redirect for admin console. */
  ssoProvider: string | null;
  /** Full domain display name. */
  displayName: string;
  /** Rate-limit tokens topic. TODO: underspecified — exact rate key not chosen yet. */
  rateLimits: Record<string, number>;
  /** Retention policy for deleted messages: `retain`, `purge_after_hours`, `purge_immediately`. */
  messageRetention: "retain" | "purge_after_hours" | "purge_immediately";
  /** extra custom metadata */
  metadata: Record<string, unknown>;
  /** updatedAt */
  updatedAt: Date;
};

/**
 * Domain — a registered FUSE domain; essentially a tenant.
 */
export type Domain = {
  /** PK. */
  id: string;
  /** The DNS zone (e.g. `acme.corp`). */
  name: string;
  /** Owner-facing contact email. */
  contactEmail: string;
  /** POST-verified at signup; must match DNS. */
  verified: boolean;
  /** Active by default; set false to disable all channels for a domain. */
  active: boolean;
  /** Default trust level for this domain when acting as a peer. */
  trustLevel: TrustLevel;
  /** This domain's DNS TXT records (cached in Postgres by the discovery worker). */
  dnsRecords: DnsRecord[];
  /** Frozen per-domain configuration. */
  config: DomainConfig;
  /** Created timestamp. */
  createdAt: Date;
};

/**
 * Zod schema for Domain.
 */
export const DomainSchema: z.ZodType<Domain> = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255),
  contactEmail: z.string().email(),
  verified: z.boolean().default(false),
  active: z.boolean().default(true),
  trustLevel: z.union([
    z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4),
  ]),
  dnsRecords: z.array(z.object({
    label: z.string(),
    rdata: z.array(z.string()),
    ttl: z.number().int().positive(),
    domainId: z.string().uuid(),
  })),
  config: z.object({
    domainId: z.string().uuid(),
    federationEnabled: z.boolean().default(false),
    defaultPeerTrustLevel: z.union([
      z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4),
    ]),
    maxMessageSizeBytes: z.number().int().positive().default(10_485_760),
    sessionStrategy: z.enum(["cookie", "header", "jwt"]).default("cookie"),
    ssoProvider: z.string().nullable().default(null),
    displayName: z.string().max(255).default(""),
    rateLimits: z.record(z.string(), z.number()),
    messageRetention: z.enum(["retain", "purge_after_hours", "purge_immediately"])
      .default("retain"),
    metadata: z.record(z.string(), z.unknown()).default({}),
    updatedAt: z.coerce.date(),
  }),
  createdAt: z.coerce.date(),
});
