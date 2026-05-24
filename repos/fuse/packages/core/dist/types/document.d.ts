import { z } from "zod";
/**
 * BlockType — the set of supported block types in the FUSE document editor.
 *
 * These are used by `isBlockType()` at render time and by `BlockFilter` for
 * inline queries.
 */
export type BlockType = "paragraph" | "heading" | "heading2" | "heading3" | "bulletList" | "orderedList" | "taskList" | "codeBlock" | "blockQuote" | "divider" | "image" | "file" | "mention" | "channelLink" | "meetingNote" | "adr" | "postmortem" | "okr" | "embed" | "reactionBar" | "table";
/**
 * BlockAttributes — per-block extended metadata panel.
 */
export type BlockAttributes = {
    /** Explicit caret position stored in collaboration payloads. */
    caret?: {
        from: number;
        to: number;
    };
    /** Whether the block is currently collapsed in the UI. */
    collapsed?: boolean;
    /** Language hint for code blocks. */
    language?: string;
    /** Alt-text for image blocks. */
    alt?: string;
    /** URL for embed / image / file blocks. */
    url?: string;
    /** Mentioned identities. */
    mentionedIds?: string[];
    /** Meeting note link (meetingId → is timestamp query param). */
    meetingId?: string;
    /** ADR properties. */
    adrStatus?: "proposed" | "accepted" | "rejected" | "superseded";
    /** Any custom annotation set by extensions or bots. */
    custom?: Record<string, unknown>;
};
/**
 * Block — the smallest editable unit in a FUSE document page.
 */
export type Block = {
    /** PK UUID. */
    id: string;
    /** FK → pages.id. */
    pageId: string;
    /** Zero-based index within the page's block array. */
    index: number;
    /** Ordered array of child block IDs (for list nesting / embedding). */
    children: string[];
    /** Human-readable block type discriminator. */
    type: BlockType;
    /** Raw inline content stored as Yjs Y.Text string. */
    content: string;
    /** Extended metadata panel. */
    attributes: BlockAttributes;
    /** Author of this block (for collaboration attribution). */
    authorId: string;
    /** Created timestamp. */
    createdAt: Date;
    /** Updated timestamp. */
    updatedAt: Date | null;
    /** Deleted timestamp — soft-delete; use `deletedAt IS NULL` for active blocks. */
    deletedAt: Date | null;
    /** Optional Yjs struct log entry for conflict replay. */
    yjsLogHash: string | null;
};
/**
 * Page — a named document (or "page") within a channel or DM context.
 *
 * TODO: underspecified — namespace / scoping rules for pages (domain-global
 * vs channel-scoped) are not yet locked down.
 */
export type Page = {
    /** PK. */
    id: string;
    /** FK → channels.id; null for global domain pages. */
    channelId: string | null;
    /** FK → identities.id — who created the page. */
    createdById: string;
    /** Human-readable slug / name. */
    slug: string;
    /** Page title rendered in the sidebar. */
    title: string;
    /** Whether the page is archived. */
    archived: boolean;
    /** Whether the page is visible to all channel members or only owners/admins. */
    locked: boolean;
    /** The first block ID; root of the block tree. */
    rootBlockId: string | null;
    /** Full block tree as flat array (cached materialised view). */
    blocks: Block[];
    /** Page-level tags / labels for discovery and filtering. */
    labels: string[];
    /** Page config (default permissions, template ref, etc.). */
    config: Record<string, unknown>;
    /** Created timestamp. */
    createdAt: Date;
    /** Last-modified timestamp. */
    updatedAt: Date | null;
};
export declare const BlockSchema: z.ZodType<Block>;
export declare const PageSchema: z.ZodType<Page>;
//# sourceMappingURL=document.d.ts.map