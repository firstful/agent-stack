/**
 * meeting-repo.ts — data-access for meeting operations.
 */
import type { Pool } from "pg";
import type { Meeting, MeetingState } from "../types/meeting.js";
export declare function createMeeting(pool: Pool, data: {
    channelId: string;
    createdById: string;
    title: string;
    scheduledAt?: Date | null;
}): Promise<Meeting>;
export declare function getMeetingById(pool: Pool, id: string): Promise<Meeting | null>;
export declare function updateMeeting(pool: Pool, id: string, data: Partial<{
    state: MeetingState;
    title: string;
    scheduledAt: Date | null;
    startedAt: Date | null;
    endedAt: Date | null;
    recordingRequested: boolean;
    metadata: Record<string, unknown>;
}>): Promise<Meeting | null>;
//# sourceMappingURL=meeting-repo.d.ts.map