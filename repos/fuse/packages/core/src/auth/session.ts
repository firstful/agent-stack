/**
 * session.ts — session / JWT management with Zod-validated payloads.
 *
 * TODO: underspecified — session type selection (cookie vs JWT vs header) is
 * configured per-domain in DomainConfig; this module implements the JWT path as
 * the reference implementation.
 */

import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import type { Identity } from "../types/identity.js";

/** Secret loaded from env; never hard-code. */
const JWT_SECRET =
  process.env.JWT_SECRET ??
  (() => { throw new Error("JWT_SECRET is not set"); })();

const SessionPayloadSchema = z.object({
  sub:        z.string().uuid(),
  domainId:   z.string().uuid(),
  handle:     z.string(),
  type:       z.enum(["human","agent","shared","service","guest"]),
  role:       z.string().optional(),
  deviceId:   z.string().optional(),
});

export type SessionPayload = z.infer<typeof SessionPayloadSchema>;

/**
 * device registry stub — maps identity IDs → Set of device IDs they own.
 */
const _deviceRegistry: Map<string, Set<string>> = new Map();

/**
 * registerDevice — record a new device for an identity.
 */
export function registerDevice(identityId: string, deviceId: string): void {
  const set = _deviceRegistry.get(identityId) ?? new Set<string>();
  set.add(deviceId);
  _deviceRegistry.set(identityId, set);
}

/**
 * revokeDevice — remove a device from an identity's set.
 */
export function revokeDevice(identityId: string, deviceId: string): void {
  _deviceRegistry.get(identityId)?.delete(deviceId);
}

/**
 * getDevices — return all currently known devices for an identity.
 */
export function getDevices(identityId: string): string[] {
  return [...(_deviceRegistry.get(identityId) ?? new Set())];
}

/**
 * createSession — mint a signed JWT containing the identity payload.
 */
export async function createSession(
  identity:       Identity,
  deviceId?:      string,
): Promise<string> {
  const payload: SessionPayload = {
    sub: identity.id,
    domainId: identity.domainId,
    handle: identity.handle,
    type: identity.type as SessionPayload["type"],
    deviceId,
  };

  if (deviceId) registerDevice(identity.id, deviceId);

  return new SignJWT(payload as any)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(new TextEncoder().encode(JWT_SECRET));
}

/**
 * verifySession — verify a `Bearer` JWT and return the validated payload (or null).
 */
export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(JWT_SECRET));
    return SessionPayloadSchema.parse({
      sub: payload.sub as string,
      domainId: payload.domainId as string,
      handle: payload.handle as string,
      type: payload.type as z.TypeOf<typeof SessionPayloadSchema>["type"],
      role: (payload as any).role as string | undefined,
      deviceId: (payload as any).deviceId as string | undefined,
    });
  } catch {
    return null;
  }
}

/**
 * revokeAllSessions — noop stub — wipes the device registry.
 */
export function revokeAllSessions(_identityId: string): void {
  // TODO: Not implemented — query all identity_sessions rows and revoke.
}
