/**
 * session.ts — session / JWT management with Zod-validated payloads.
 *
 * TODO: underspecified — session type selection (cookie vs JWT vs header) is
 * configured per-domain in DomainConfig; this module implements the JWT path as
 * the reference implementation.
 */
import { z } from "zod";
import type { Identity } from "../types/identity.js";
declare const SessionPayloadSchema: z.ZodObject<{
    sub: z.ZodString;
    domainId: z.ZodString;
    handle: z.ZodString;
    type: z.ZodEnum<{
        human: "human";
        agent: "agent";
        shared: "shared";
        service: "service";
        guest: "guest";
    }>;
    role: z.ZodOptional<z.ZodString>;
    deviceId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type SessionPayload = z.infer<typeof SessionPayloadSchema>;
/**
 * registerDevice — record a new device for an identity.
 */
export declare function registerDevice(identityId: string, deviceId: string): void;
/**
 * revokeDevice — remove a device from an identity's set.
 */
export declare function revokeDevice(identityId: string, deviceId: string): void;
/**
 * getDevices — return all currently known devices for an identity.
 */
export declare function getDevices(identityId: string): string[];
/**
 * createSession — mint a signed JWT containing the identity payload.
 */
export declare function createSession(identity: Identity, deviceId?: string): Promise<string>;
/**
 * verifySession — verify a `Bearer` JWT and return the validated payload (or null).
 */
export declare function verifySession(token: string): Promise<SessionPayload | null>;
/**
 * revokeAllSessions — noop stub — wipes the device registry.
 */
export declare function revokeAllSessions(_identityId: string): void;
export {};
//# sourceMappingURL=session.d.ts.map