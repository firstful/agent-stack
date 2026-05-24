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

const provider = process.env.FUSE_CLOUD_PROVIDER ?? "generic";

export function getAiProvider(): AiProvider {
  switch (provider) {
    // TODO: implement AWS Bedrock, GCP Vertex AI, Azure OpenAI adapters
    default:
      throw new Error("No AI provider configured. Set FUSE_CLOUD_PROVIDER or provide an OpenAI-compatible endpoint.");
  }
}

export function getEmailProvider(): EmailProvider {
  switch (provider) {
    // TODO: implement SES, SendGrid adapters
    default:
      throw new Error("No email provider configured. Set FUSE_CLOUD_PROVIDER or configure SMTP directly.");
  }
}

export function getQueueProvider(): QueueProvider {
  switch (provider) {
    // TODO: implement SQS, PubSub adapters
    default:
      throw new Error("No queue provider configured.");
  }
}

export function getKmsProvider(): KmsProvider {
  switch (provider) {
    // TODO: implement AWS KMS, GCP Cloud KMS, Azure Key Vault adapters
    default:
      throw new Error("No KMS provider configured.");
  }
}
