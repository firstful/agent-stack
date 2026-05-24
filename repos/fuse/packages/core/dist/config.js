/**
 * config.ts — runtime configuration loaded from environment variables, validated with Zod.
 *
 * All fields have a sensible default so that the app starts cleanly in development
 * without an exhaustive .env file (SET ... DEFAULTS).  In production all secrets
 * MUST be set via environment variables injected by the deployment platform.
 */
import { z } from "zod";
// ---------------------------------------------------------------------------
// Core validation schema
// ---------------------------------------------------------------------------
const EnvSchema = z.object({
    /** "development" | "production" | "test" */
    NODE_ENV: z.string().default("development"),
    /** HTTP API listen port. */
    PORT: z.coerce.number().int().positive().default(3000),
    /** HTTP API listen host. */
    HOST: z.string().default("0.0.0.0"),
    /** Postgres connection string. */
    DATABASE_URL: z.string().url().default("postgresql://fuselocal:fuselocalpw@localhost:5432/fuse"),
    /** WebSocket listen port (same as PORT by default). */
    WS_PORT: z.coerce.number().int().positive().default(3000),
    /** SMTP proxy listen port. */
    SMTP_PORT: z.coerce.number().int().positive().default(587),
    /** Maddy SMTP relay host. */
    MADDY_HOST: z.string().default("localhost"),
    /** Maddy SMTP relay port. */
    MADDY_SMTP_PORT: z.coerce.number().int().positive().default(2525),
    // Object storage
    S3_ENDPOINT: z.string().url().optional().nullable().or(z.literal("")),
    S3_ACCESS_KEY: z.string().optional().nullable().or(z.literal("")),
    S3_SECRET_KEY: z.string().optional().nullable().or(z.literal("")),
    S3_BUCKET: z.string().default("fuse-media"),
    // Auth
    SESSION_SECRET: z.string().min(16, "SESSION_SECRET must be at least 16 chars"),
    JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 chars"),
    MAGIC_LINK_TOKEN_TTL: z.coerce.number().int().positive().default(86_400),
    // Domain / federation
    FUSE_DOMAIN: z.string().default("localhost:3000"),
    TRUST_LEVEL_THRESHOLD: z.coerce.number().int().min(0).max(4).default(2),
    // OAuth
    GOOGLE_CLIENT_ID: z.string().optional().nullable().or(z.literal("")),
    GOOGLE_CLIENT_SECRET: z.string().optional().nullable().or(z.literal("")),
    GITHUB_CLIENT_ID: z.string().optional().nullable().or(z.literal("")),
    GITHUB_CLIENT_SECRET: z.string().optional().nullable().or(z.literal("")),
    MICROSOFT_CLIENT_ID: z.string().optional().nullable().or(z.literal("")),
    MICROSOFT_CLIENT_SECRET: z.string().optional().nullable().or(z.literal("")),
    // Logging
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});
// ---------------------------------------------------------------------------
// Public typed config object
// ---------------------------------------------------------------------------
const env = EnvSchema.parse(process.env);
/** Full parsed config — import this everywhere instead of reading `process.env` directly. */
export const config = {
    NODE_ENV: env.NODE_ENV,
    PORT: env.PORT,
    HOST: env.HOST,
    DATABASE_URL: env.DATABASE_URL,
    WS_PORT: env.WS_PORT,
    SMTP_PORT: env.SMTP_PORT,
    MADDY_HOST: env.MADDY_HOST,
    MADDY_SMTP_PORT: env.MADDY_SMTP_PORT,
    S3_ENDPOINT: env.S3_ENDPOINT ?? undefined,
    S3_ACCESS_KEY: env.S3_ACCESS_KEY ?? undefined,
    S3_SECRET_KEY: env.S3_SECRET_KEY ?? undefined,
    S3_BUCKET: env.S3_BUCKET,
    SESSION_SECRET: env.SESSION_SECRET,
    JWT_SECRET: env.JWT_SECRET,
    MAGIC_LINK_TOKEN_TTL: env.MAGIC_LINK_TOKEN_TTL,
    FUSE_DOMAIN: env.FUSE_DOMAIN,
    TRUST_LEVEL_THRESHOLD: env.TRUST_LEVEL_THRESHOLD,
    GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID ?? undefined,
    GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET ?? undefined,
    GITHUB_CLIENT_ID: env.GITHUB_CLIENT_ID ?? undefined,
    GITHUB_CLIENT_SECRET: env.GITHUB_CLIENT_SECRET ?? undefined,
    MICROSOFT_CLIENT_ID: env.MICROSOFT_CLIENT_ID ?? undefined,
    MICROSOFT_CLIENT_SECRET: env.MICROSOFT_CLIENT_SECRET ?? undefined,
    LOG_LEVEL: env.LOG_LEVEL,
};
//# sourceMappingURL=config.js.map