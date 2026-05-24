/**
 * providers/email.ts — transactional email provider adapters.
 *
 * Magic links, invites, and system notifications are sent through
 * whichever provider is configured.  Falls back to direct SMTP.
 */
import type { EmailProvider } from "./index.js";
export declare function createEmailProvider(providerName: string): EmailProvider;
//# sourceMappingURL=email.d.ts.map