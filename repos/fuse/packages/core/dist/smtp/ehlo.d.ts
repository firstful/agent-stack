/**
 * ehlo.ts — EHLO response builder.
 *
 * FUSE extends the EHLO response with two custom keywords so that compatible
 * clients can opt into richer in-band features before starting DATA.
 */
/**
 * handleEhlo — called by the SMTPServer onEHLOAsync handler.
 *
 * @returns The additional keyword lines FUSE adds to the EHLO response.
 */
export declare function handleEhlo(): string[];
/**
 * isFuseClient — check whether a given EHLO string included the `FUSE` 8BITMIME keyword.
 * Returns false if the client advertised only stock capabilities.
 */
export declare function isFuseClient(ehloResponse: string[]): boolean;
//# sourceMappingURL=ehlo.d.ts.map