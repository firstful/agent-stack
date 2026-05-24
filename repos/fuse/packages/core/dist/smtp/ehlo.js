/**
 * ehlo.ts — EHLO response builder.
 *
 * FUSE extends the EHLO response with two custom keywords so that compatible
 * clients can opt into richer in-band features before starting DATA.
 */
/**
 * EHLO_KEYWORDS — static set of FUSE-specific SMTP service extensions.
 *
 * | Keyword        | Required RFC 5321 support |
 * |----------------|--------------------------|
 * | `STARTFUSE`    | Upgrades connection to webhook relay mode |
 * | `RICH_MAIL`    | Converts multi-part JSON → RFC 5322 substitution |
 * | `8BITMIME`     | Standard RFC 6152 — advertised unconditionally |
 * | `PIPELINING`   | Standard RFC 2920 — advertised unconditionally |
 * | `SIZE 10485760`| Max message size (10 MiB) — matches Maddy config |
 */
const EHLO_KEYWORDS = [
    "FUSE",
    "8BITMIME",
    "PIPELINING",
    "SIZE 10485760",
    "RICH_MAIL",
    "STARTFUSE",
];
/**
 * handleEhlo — called by the SMTPServer onEHLOAsync handler.
 *
 * @returns The additional keyword lines FUSE adds to the EHLO response.
 */
export function handleEhlo() {
    return EHLO_KEYWORDS;
}
/**
 * isFuseClient — check whether a given EHLO string included the `FUSE` 8BITMIME keyword.
 * Returns false if the client advertised only stock capabilities.
 */
export function isFuseClient(ehloResponse) {
    return ehloResponse.some((line) => /^FUSE\s/i.test(line) ||
        /^RICH_MAIL\s/i.test(line) ||
        /^STARTFUSE\s/i.test(line));
}
//# sourceMappingURL=ehlo.js.map