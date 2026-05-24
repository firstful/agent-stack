import type { Pool } from "pg";
import type { Channel, ChannelType, ChannelMember, ChannelPermissions } from "../types/channel.js";
export declare function createChannel(pool: Pool, data: {
    domainId: string;
    name: string;
    type: ChannelType;
    description?: string | null;
    config?: Record<string, unknown>;
    crossOrgEnabled?: boolean;
    smtpAddress: string;
    createdById: string;
}): Promise<Channel>;
export declare function getChannelById(pool: Pool, id: string): Promise<Channel | null>;
export declare function listChannelsByDomain(pool: Pool, domainId: string): Promise<Channel[]>;
export declare function updateChannel(pool: Pool, id: string, data: Partial<{
    name: string;
    type: ChannelType;
    description: string | null;
    config: Record<string, unknown>;
    crossOrgEnabled: boolean;
    smtpAddress: string;
}>): Promise<Channel | null>;
export declare function deleteChannel(pool: Pool, id: string): Promise<boolean>;
export declare function addMember(pool: Pool, { channelId, identityId, role }: {
    channelId: string;
    identityId: string;
    role: "owner" | "admin" | "member" | "guest";
}): Promise<ChannelMember>;
export declare function removeMember(pool: Pool, channelId: string, identityId: string): Promise<boolean>;
export declare function getMembers(pool: Pool, channelId: string): Promise<ChannelMember[]>;
export declare function getPermissions(pool: Pool, channelId: string): Promise<ChannelPermissions | null>;
export declare function updatePermissions(pool: Pool, channelId: string, data: Partial<{
    writeMembers: boolean;
    writeGuests: boolean;
    writeCrossOrg: boolean;
    maxAttachmentBytes: number;
    attachmentsEnabled: boolean;
    auditLog: unknown[];
    approvalRequired: Record<string, unknown>;
}>): Promise<ChannelPermissions>;
//# sourceMappingURL=channel-repo.d.ts.map