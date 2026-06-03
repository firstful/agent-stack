/**
 * Input sanitization utilities.
 *
 * Strip script tags, event handlers, and dangerous HTML from user text input.
 * Designed for server-side use on all user-submitted text fields.
 * Includes length limiting and deep object sanitization.
 */
// ── Strips <script>...</script> and <script .../> ──
const SCRIPT_TAG_RE = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script\s*>/gi;
const SCRIPT_SHORT_RE = /<script\b[^>]*\/>/gi;
// ── Strips event handler attributes (onclick, onload, onerror, etc.) ──
const EVENT_HANDLER_RE = /\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi;
// ── Strips javascript: / data: in href / src attributes ──
const DANGEROUS_PROTOCOLS_RE = /\s+(?:href|src|action|formaction|data|xlink:href)\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*')/gi;
const DATA_PROTOCOL_RE = /\s+(?:href|src)\s*=\s*(?:"data:[^"]*"|'data:[^']*')/gi;
// ── Strips HTML tags entirely (for plain-text fields) ──
const HTML_TAG_RE = /<[^>]*>/g;
// ── Default max lengths for text fields ──
export const MAX_LENGTHS = {
    username: 30,
    groupName: 100,
    bio: 500,
    nickname: 100,
    impulseTitle: 200,
    impulseDescription: 2000,
    draftContent: 5000,
    dmContent: 5000,
    messageContent: 10000,
    generic: 5000,
};
/**
 * Strip <script> tags and event handler attributes from a string.
 * Safe for fields that may contain limited HTML (e.g. group bio).
 */
export function stripScriptTags(value) {
    return value
        .replace(SCRIPT_TAG_RE, "")
        .replace(SCRIPT_SHORT_RE, "")
        .replace(EVENT_HANDLER_RE, "")
        .replace(DANGEROUS_PROTOCOLS_RE, "")
        .replace(DATA_PROTOCOL_RE, "");
}
/**
 * Full sanitization: strip all HTML tags, script tags, event handlers,
 * and dangerous protocols. Safe for plain-text fields like usernames,
 * impulse titles, nicknames, and draft content.
 */
export function stripAllHtml(value) {
    return stripScriptTags(value).replace(HTML_TAG_RE, "");
}
/**
 * Trim whitespace and collapse multiple spaces/newlines.
 */
export function normalizeWhitespace(value) {
    return value.replace(/\s+/g, " ").trim();
}
/**
 * Full sanitization pipeline for plain-text fields:
 * 1. Strip all HTML tags and dangerous content
 * 2. Normalize whitespace
 */
export function sanitizeText(value) {
    return normalizeWhitespace(stripAllHtml(value));
}
/**
 * Sanitization pipeline for fields that may include limited formatting
 * (e.g. group bio, message content):
 * 1. Strip script tags and event handlers only
 * 2. Trim leading/trailing whitespace
 */
export function sanitizeRichText(value) {
    return stripScriptTags(value).trim();
}
/**
 * Truncate a string to the given maximum length, preserving whole words
 * at the boundary when possible.
 */
export function truncate(value, maxLength) {
    if (value.length <= maxLength)
        return value;
    const truncated = value.slice(0, maxLength);
    // Try to break at last space to avoid cutting words
    const lastSpace = truncated.lastIndexOf(" ");
    if (lastSpace > maxLength * 0.8) {
        return truncated.slice(0, lastSpace) + "…";
    }
    return truncated + "…";
}
/**
 * Sanitize and truncate a plain-text string.
 * Strips all HTML, normalises whitespace, then truncates to maxLength.
 */
export function sanitizeAndTruncate(value, maxLength = MAX_LENGTHS.generic) {
    return truncate(sanitizeText(value), maxLength);
}
/**
 * Sanitize and truncate a rich-text string.
 * Strips script tags / event handlers, trims, then truncates to maxLength.
 */
export function sanitizeRichAndTruncate(value, maxLength = MAX_LENGTHS.generic) {
    return truncate(sanitizeRichText(value), maxLength);
}
/**
 * Sanitize all string fields in an object using the given field→maxLength map.
 * Fields not in the map use the generic max length.
 * Returns a new object (does not mutate).
 */
export function sanitizeObject(obj, fieldLengths) {
    const result = { ...obj };
    for (const key of Object.keys(result)) {
        const val = result[key];
        if (typeof val === "string") {
            const maxLen = fieldLengths?.[key] ?? MAX_LENGTHS.generic;
            result[key] = sanitizeText(val);
            // Truncate after sanitization (sanitized string may still exceed limit)
            if (result[key].length > maxLen) {
                result[key] = truncate(result[key], maxLen);
            }
        }
        else if (val !== null && typeof val === "object" && !Array.isArray(val)) {
            result[key] = sanitizeObject(val, fieldLengths);
        }
    }
    return result;
}
//# sourceMappingURL=sanitize.js.map