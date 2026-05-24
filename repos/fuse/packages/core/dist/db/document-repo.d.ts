/**
 * DocumentRepository — data-access contract for page / block operations.
 */
import type { Pool } from "pg";
import type { Block, Page } from "../types/document.js";
export interface DocumentRepository {
    /** Create a page. */
    createPage(page: Page): Promise<Page>;
    /** Fetch a page by ID. */
    getPageById(id: string): Promise<Page | null>;
    /** Fetch a page by slug within a channel. */
    getPageBySlug(channelId: string, slug: string): Promise<Page | null>;
    /** List pages for a channel. */
    listPagesByChannel(channelId: string): Promise<Page[]>;
    /** Update page-level fields. */
    updatePage(id: string, changes: Partial<Page>): Promise<Page | null>;
    /** Archive / un-archive a page. */
    setArchived(id: string, archived: boolean): Promise<boolean>;
    /** Insert a block into a page at a given index. */
    insertBlock(pageId: string, block: Block): Promise<Block>;
    /** Update a block's content / attributes. */
    updateBlock(id: string, changes: Partial<Block>): Promise<Block | null>;
    /** Soft-delete a block. */
    deleteBlock(id: string): Promise<boolean>;
    /** Fetch all active (non-deleted) blocks for a page. */
    listActiveBlocks(pageId: string): Promise<Block[]>;
    /** Update the block tree ordering (re-insert at new index). */
    reorderBlock(blockId: string, newIndex: number): Promise<boolean>;
}
export declare function createPage(pool: Pool, data: Page): Promise<Page>;
export declare function getPageBySlug(pool: Pool, channelId: string, slug: string): Promise<Page | null>;
export declare function updatePage(pool: Pool, id: string, changes: Partial<Page>): Promise<Page | null>;
export declare function insertBlock(pool: Pool, pageId: string, block: Block): Promise<Block>;
export declare function updateBlock(pool: Pool, id: string, changes: Partial<Block>): Promise<Block | null>;
export declare function deleteBlock(pool: Pool, id: string): Promise<boolean>;
export declare function getPageById(pool: Pool, id: string): Promise<Page | null>;
//# sourceMappingURL=document-repo.d.ts.map