import type { ImpulseStatus } from "../index";
export type Transition = {
    from: "queued";
    to: "voting" | "discarded";
} | {
    from: "voting";
    to: "composing" | "expired";
} | {
    from: "composing";
    to: "summarizing" | "expired";
} | {
    from: "summarizing";
    to: "approval" | "expired";
} | {
    from: "approval";
    to: "broadcast" | "discarded";
};
export declare function canTransition(from: ImpulseStatus, to: ImpulseStatus): boolean;
export declare function assertTransition(from: ImpulseStatus, to: ImpulseStatus): asserts to is Transition["to"];
//# sourceMappingURL=state-machine.d.ts.map