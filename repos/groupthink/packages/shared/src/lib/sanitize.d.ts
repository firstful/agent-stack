/**
 * Input sanitization utilities.
 *
 * Strip script tags, event handlers, and dangerous HTML from user text input.
 * Designed for server-side use on all user-submitted text fields.
 * Includes length limiting and deep object sanitization.
 */
export declare const MAX_LENGTHS: {
    readonly username: 30;
    readonly groupName: 100;
    readonly bio: 500;
    readonly nickname: 100;
    readonly impulseTitle: 200;
    readonly impulseDescription: 2000;
    readonly draftContent: 5000;
    readonly dmContent: 5000;
    readonly messageContent: 10000;
    readonly generic: 5000;
};
/**
 * Strip <script> tags and event handler attributes from a string.
 * Safe for fields that may contain limited HTML (e.g. group bio).
 */
export declare function stripScriptTags(value: string): string;
/**
 * Full sanitization: strip all HTML tags, script tags, event handlers,
 * and dangerous protocols. Safe for plain-text fields like usernames,
 * impulse titles, nicknames, and draft content.
 */
export declare function stripAllHtml(value: string): string;
/**
 * Trim whitespace and collapse multiple spaces/newlines.
 */
export declare function normalizeWhitespace(value: string): string;
/**
 * Full sanitization pipeline for plain-text fields:
 * 1. Strip all HTML tags and dangerous content
 * 2. Normalize whitespace
 */
export declare function sanitizeText(value: string): string;
/**
 * Sanitization pipeline for fields that may include limited formatting
 * (e.g. group bio, message content):
 * 1. Strip script tags and event handlers only
 * 2. Trim leading/trailing whitespace
 */
export declare function sanitizeRichText(value: string): string;
/**
 * Truncate a string to the given maximum length, preserving whole words
 * at the boundary when possible.
 */
export declare function truncate(value: string, maxLength: number): string;
/**
 * Sanitize and truncate a plain-text string.
 * Strips all HTML, normalises whitespace, then truncates to maxLength.
 */
export declare function sanitizeAndTruncate(value: string, maxLength?: number): string;
/**
 * Sanitize and truncate a rich-text string.
 * Strips script tags / event handlers, trims, then truncates to maxLength.
 */
export declare function sanitizeRichAndTruncate(value: string, maxLength?: number): string;
/**
 * Sanitize all string fields in an object using the given field→maxLength map.
 * Fields not in the map use the generic max length.
 * Returns a new object (does not mutate).
 */
export declare function sanitizeObject<T extends Record<string, unknown>>(obj: T, fieldLengths?: Partial<Record<string, number>>): T;
//# sourceMappingURL=sanitize.d.ts.map