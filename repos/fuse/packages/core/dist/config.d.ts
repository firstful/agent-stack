/**
 * config.ts — runtime configuration loaded from environment variables, validated with Zod.
 *
 * All fields have a sensible default so that the app starts cleanly in development
 * without an exhaustive .env file (SET ... DEFAULTS).  In production all secrets
 * MUST be set via environment variables injected by the deployment platform.
 */
import { z } from "zod";
declare const EnvSchema: z.ZodObject<{
    NODE_ENV: z.ZodDefault<z.ZodString>;
    PORT: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    HOST: z.ZodDefault<z.ZodString>;
    DATABASE_URL: z.ZodDefault<z.ZodString>;
    WS_PORT: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    SMTP_PORT: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    MADDY_HOST: z.ZodDefault<z.ZodString>;
    MADDY_SMTP_PORT: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    S3_ENDPOINT: z.ZodUnion<[z.ZodNullable<z.ZodOptional<z.ZodString>>, z.ZodLiteral<"">]>;
    S3_ACCESS_KEY: z.ZodUnion<[z.ZodNullable<z.ZodOptional<z.ZodString>>, z.ZodLiteral<"">]>;
    S3_SECRET_KEY: z.ZodUnion<[z.ZodNullable<z.ZodOptional<z.ZodString>>, z.ZodLiteral<"">]>;
    S3_BUCKET: z.ZodDefault<z.ZodString>;
    SESSION_SECRET: z.ZodString;
    JWT_SECRET: z.ZodString;
    MAGIC_LINK_TOKEN_TTL: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    FUSE_DOMAIN: z.ZodDefault<z.ZodString>;
    TRUST_LEVEL_THRESHOLD: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    GOOGLE_CLIENT_ID: z.ZodUnion<[z.ZodNullable<z.ZodOptional<z.ZodString>>, z.ZodLiteral<"">]>;
    GOOGLE_CLIENT_SECRET: z.ZodUnion<[z.ZodNullable<z.ZodOptional<z.ZodString>>, z.ZodLiteral<"">]>;
    GITHUB_CLIENT_ID: z.ZodUnion<[z.ZodNullable<z.ZodOptional<z.ZodString>>, z.ZodLiteral<"">]>;
    GITHUB_CLIENT_SECRET: z.ZodUnion<[z.ZodNullable<z.ZodOptional<z.ZodString>>, z.ZodLiteral<"">]>;
    MICROSOFT_CLIENT_ID: z.ZodUnion<[z.ZodNullable<z.ZodOptional<z.ZodString>>, z.ZodLiteral<"">]>;
    MICROSOFT_CLIENT_SECRET: z.ZodUnion<[z.ZodNullable<z.ZodOptional<z.ZodString>>, z.ZodLiteral<"">]>;
    LOG_LEVEL: z.ZodDefault<z.ZodEnum<{
        error: "error";
        fatal: "fatal";
        warn: "warn";
        info: "info";
        debug: "debug";
        trace: "trace";
    }>>;
}, z.core.$strip>;
/** Full parsed config — import this everywhere instead of reading `process.env` directly. */
export declare const config: z.infer<typeof EnvSchema>;
export {};
//# sourceMappingURL=config.d.ts.map