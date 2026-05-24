/**
 * blocks.ts — block type definitions and renderers.
 *
 * All 20+ block types are declared as a discriminated union and rendered by
 * `renderBlock()` which is an exhaustive `switch` over `BlockType`.
 *
 * Rendered output is plain HTML in the current skeleton; plugging in a markdown
 * renderer (marked/remark) or a rich-text renderer (ProseMirror / TipTap) is
 * a first-class consumer of this module and is not in scope here.
 */
import type { Block } from "../types/document.js";
/**
 * renderBlock — exhaustive switch over every `BlockType`.
 *
 * For block types, the HTML container class maps directly to the type string.
 *
 * @param block The block row to render; `content` is treated as pre-HTML for
 *              code blocks / paragraphs and as raw text for all other types.
 * @returns     Rendered HTML string.
 */
export declare function renderBlock(block: Block): string;
//# sourceMappingURL=blocks.d.ts.map