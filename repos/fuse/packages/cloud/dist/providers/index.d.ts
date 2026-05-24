/**
 * providers/index.ts — cloud provider adapter factory.
 *
 * Reads FUSE_CLOUD_PROVIDER from the environment and wires the correct
 * implementation for each service.  The rest of the codebase (including
 * all of @fuse/core) never imports a cloud SDK directly.
 */
export interface AiProvider {
    complete(prompt: string, options?: Record<string, unknown>): Promise<string>;
}
export interface EmailProvider {
    sendMagicLink(to: string, link: string): Promise<void>;
    sendInvite(to: string, from: string, orgName: string): Promise<void>;
}
export interface QueueProvider {
    enqueue(job: string, payload: unknown): Promise<void>;
}
export interface KmsProvider {
    encrypt(plaintext: Buffer): Promise<Buffer>;
    decrypt(ciphertext: Buffer): Promise<Buffer>;
}
export declare function getAiProvider(): AiProvider;
export declare function getEmailProvider(): EmailProvider;
export declare function getQueueProvider(): QueueProvider;
export declare function getKmsProvider(): KmsProvider;
//# sourceMappingURL=index.d.ts.map