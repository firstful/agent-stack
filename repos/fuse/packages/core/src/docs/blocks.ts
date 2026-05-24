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

import type { Block, BlockAttributes } from "../types/document.js";

/**
 * renderBlock — exhaustive switch over every `BlockType`.
 *
 * For block types, the HTML container class maps directly to the type string.
 *
 * @param block The block row to render; `content` is treated as pre-HTML for
 *              code blocks / paragraphs and as raw text for all other types.
 * @returns     Rendered HTML string.
 */
export function renderBlock(block: Block): string {
  const { type, content, attributes, index } = block;

  switch (type) {
    // ── Paragraph ────────────────────────────────────────────────────────────
    case "paragraph":
      return `<p class="fuse-block fuse-block-paragraph" data-index="${index}">${esc(content)}</p>`;

    // ── Headings ─────────────────────────────────────────────────────────────
    case "heading":
      return `<h1 class="fuse-block fuse-block-heading" data-index="${index}">${esc(content)}</h1>`;
    case "heading2":
      return `<h2 class="fuse-block fuse-block-heading-2" data-index="${index}">${esc(content)}</h2>`;
    case "heading3":
      return `<h3 class="fuse-block fuse-block-heading-3" data-index="${index}">${esc(content)}</h3>`;

    // ── Lists ────────────────────────────────────────────────────────────────
    case "bulletList":
      return `<ul class="fuse-block fuse-block-bullet-list" data-index="${index}"><li>${esc(content)}</li></ul>`;
    case "orderedList":
      return `<ol class="fuse-block fuse-block-ordered-list" data-index="${index}"><li>${esc(content)}</li></ol>`;
    case "taskList":
      const checked = attributes.custom?.checked === true ? ` checked="checked"` : "";
      return `<label class="fuse-block fuse-block-task-list" data-index="${index}"><input type="checkbox"${checked}> ${esc(content)}</label>`;

    // ── Code ─────────────────────────────────────────────────────────────────
    case "codeBlock":
      const lang = att(attributes, "language", "");
      return `<pre class="fuse-block fuse-block-code" data-index="${index}" data-lang="${esc(lang)}"><code>${esc(content)}</code></pre>`;

    // ── Callout ──────────────────────────────────────────────────────────────
    case "blockQuote":
      return `<blockquote class="fuse-block fuse-block-quote" data-index="${index}">${esc(content)}</blockquote>`;

    // ── Media ────────────────────────────────────────────────────────────────
    case "image":
      const alt = att(attributes, "alt", "");
      const src = att(attributes, "url", "");
      return `<figure class="fuse-block fuse-block-image" data-index="${index}"><img src="${esc(src)}" alt="${esc(alt)}" loading="lazy"></figure>`;
    case "file":
      const furl = att(attributes, "url", "");
      return `<a class="fuse-block fuse-block-file" data-index="${index}" href="${esc(furl)}">${esc(content)}</a>`;

    // ── Inline / embed ───────────────────────────────────────────────────────
    case "mention":
      const mentionedIds = (attributes.mentionedIds ?? []) as string[];
      return `<span class="fuse-block fuse-block-mention" data-index="${index}" data-mentions="${mentionedIds.map(esc).join(",")}">@${esc(content)}</span>`;
    case "channelLink":
      return `<a class="fuse-block fuse-block-channel-link" data-index="${index}" href="#channel">#${esc(content)}</a>`;
    case "divider":
      return `<hr class="fuse-block fuse-block-divider" data-index="${index}">`;
    case "embed":
      const eurl = att(attributes, "url", "");
      return `<iframe class="fuse-block fuse-block-embed" data-index="${index}" src="${esc(eurl)}" sandbox="" loading="lazy"></iframe>`;

    // ── Structured ───────────────────────────────────────────────────────────
    case "meetingNote":
      const mid = att(attributes, "meetingId", "");
      return `<section class="fuse-block fuse-block-meeting-note" data-index="${index}" data-meeting-id="${esc(mid)}">${esc(content)}</section>`;
    case "adr":
      const status = att(attributes, "adrStatus", "proposed") as BlockAttributes["adrStatus"];
      return `<div class="fuse-block fuse-block-adr fuse-block-adr-${esc(status)}" data-index="${index}">${esc(content)} <span class="fuse-badge">${esc(status)}</span></div>`;
    case "postmortem":
      return `<article class="fuse-block fuse-block-postmortem" data-index="${index}">${esc(content)}</article>`;
    case "okr":
      return `<section class="fuse-block fuse-block-okr" data-index="${index}">${esc(content)}</section>`;

    // ── Interactive ──────────────────────────────────────────────────────────
    case "reactionBar":
      return `<div class="fuse-block fuse-block-reaction-bar" data-index="${index}">${esc(content)}</div>`;
    case "table":
      return `<div class="fuse-block fuse-block-table" data-index="${index}"><table><tbody>${esc(content)}</tbody></table></div>`;

    default:
      // Exhaustiveness guard — TypeScript should flag this at compile time if a
      // new BlockType is added without a case here.
      const _exhaustive: never = type;
      return `<div class="fuse-block fuse-block-unknown" data-index="${index}">${esc(content)}</div>`;
  }
}

/** Small helpers to keep the switch body tidy. */
function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" } as Record<string, string>)[c] ?? c);
}
function att(attr: BlockAttributes, key: string, fallback: string): string {
  return (attr as any)?.[key] ?? fallback ?? "";
}
