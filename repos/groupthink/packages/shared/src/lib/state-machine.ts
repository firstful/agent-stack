import type { ImpulseStatus } from "../index";

export type Transition =
  | { from: "queued"; to: "voting" | "discarded" }
  | { from: "voting"; to: "composing" | "expired" }
  | { from: "composing"; to: "summarizing" | "expired" }
  | { from: "summarizing"; to: "approval" | "expired" }
  | { from: "approval"; to: "broadcast" | "discarded" };

const VALID_TRANSITIONS: Record<ImpulseStatus, ImpulseStatus[]> = {
  queued: ["voting", "discarded"],
  voting: ["composing", "expired"],
  composing: ["summarizing", "expired"],
  summarizing: ["approval", "expired"],
  approval: ["broadcast", "discarded"],
  broadcast: [],
  expired: [],
  discarded: [],
};

export function canTransition(
  from: ImpulseStatus,
  to: ImpulseStatus
): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(
  from: ImpulseStatus,
  to: ImpulseStatus
): asserts to is Transition["to"] {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid transition: ${from} → ${to}`);
  }
}
