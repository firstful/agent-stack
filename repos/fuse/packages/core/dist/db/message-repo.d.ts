import type { Pool } from "pg";
import type { Message, MessageType, MessageStatus, RichPayload } from "../types/message.js";
export declare function createMessage(pool: Pool, data: {
    channelId: string;
    authorId: string;
    body: string;
    bodyHtml?: string | null;
    parentId?: string | null;
    threadId?: string | null;
    rfc822Source?: string | null;
    rfc822ContentType?: string | null;
    richPayload?: RichPayload;
    type?: MessageType;
    status?: MessageStatus;
    smtpMessageId?: string | null;
    crossOrg?: boolean;
}): Promise<Message>;
export declare function getMessageById(pool: Pool, id: string): Promise<Message | null>;
export declare function listMessagesByChannel(pool: Pool, channelId: string, opts?: {
    limit?: number;
    cursor?: string;
}): Promise<Message[]>;
export declare function updateMessage(pool: Pool, id: string, data: Partial<{
    body: string;
    bodyHtml: string | null;
    status: MessageStatus;
    richPayload: RichPayload;
    editedById: string | null;
}>): Promise<Message | null>;
export declare function deleteMessage(pool: Pool, id: string): Promise<boolean>;
export declare function searchMessages(pool: Pool, channelId: string, query: string): Promise<Message[]>;
//# sourceMappingURL=message-repo.d.ts.map