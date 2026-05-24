/**
 * templates.ts — document template definitions.
 *
 * Each template is a factory function that returns a `blocks: Block[]` array
 * ready to be inserted as the initial content of a new page.
 *
 * Templates available:
 *   - meeting-notes     free-form markdown note for a meeting; intro header
 *                        + agenda + attendees + notes + action items block
 *   - adr              Architecture Decision Record — problem, context,
 *                        decision, consequences, alternatives considered
 *   - postmortem       5-whys root-cause structure with metadata fields
 *   - okr              Objective-and-Key-Result structure with owners + status
 */
import type { Block } from "../types/document.js";
export declare const templates: {
    /**
     * meeting-notes — free-form agenda / notes / action item structure.
     */
    "meeting-notes": (meta?: {
        title?: string;
        participants?: string[];
        date?: string;
    }) => Block[];
    /**
     * adr — Architecture Decision Record.
     */
    adr: (meta?: {
        title?: string;
    }) => Block[];
    /**
     * postmortem — struct-simple root-cause template.
     */
    postmortem: (meta?: {
        title?: string;
    }) => Block[];
    /**
     * okr — Objectives and Key Results template.
     */
    okr: (meta?: {
        title?: string;
        quarter?: string;
    }) => Block[];
};
/** Convenience: look up a template by name, return blocks array (or throw). */
export declare function getTemplate(name: keyof typeof templates, meta?: Parameters<typeof templates["meeting-notes"]>[0]): Block[];
//# sourceMappingURL=templates.d.ts.map