/**
 * providers/index.ts — cloud provider adapter factory.
 *
 * Reads FUSE_CLOUD_PROVIDER from the environment and wires the correct
 * implementation for each service.  The rest of the codebase (including
 * all of @fuse/core) never imports a cloud SDK directly.
 */
const provider = process.env.FUSE_CLOUD_PROVIDER ?? "generic";
export function getAiProvider() {
    switch (provider) {
        // TODO: implement AWS Bedrock, GCP Vertex AI, Azure OpenAI adapters
        default:
            throw new Error("No AI provider configured. Set FUSE_CLOUD_PROVIDER or provide an OpenAI-compatible endpoint.");
    }
}
export function getEmailProvider() {
    switch (provider) {
        // TODO: implement SES, SendGrid adapters
        default:
            throw new Error("No email provider configured. Set FUSE_CLOUD_PROVIDER or configure SMTP directly.");
    }
}
export function getQueueProvider() {
    switch (provider) {
        // TODO: implement SQS, PubSub adapters
        default:
            throw new Error("No queue provider configured.");
    }
}
export function getKmsProvider() {
    switch (provider) {
        // TODO: implement AWS KMS, GCP Cloud KMS, Azure Key Vault adapters
        default:
            throw new Error("No KMS provider configured.");
    }
}
//# sourceMappingURL=index.js.map