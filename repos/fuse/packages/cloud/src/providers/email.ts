/**
 * providers/email.ts — transactional email provider adapters.
 *
 * Magic links, invites, and system notifications are sent through
 * whichever provider is configured.  Falls back to direct SMTP.
 */

import type { EmailProvider } from "./index.js";

// ── SMTP (generic) ───────────────────────────────────────────────────────

class SmtpEmailProvider implements EmailProvider {
  async sendMagicLink(to: string, link: string): Promise<void> {
    // TODO: implement SMTP client (or use nodemailer/simplesmtp)
    console.log(`[email] Magic link to ${to}: ${link}`);
  }

  async sendInvite(to: string, from: string, orgName: string): Promise<void> {
    // TODO: implement SMTP client
    console.log(`[email] Invite ${to} from ${from} to ${orgName}`);
  }
}

// ── Factory ──────────────────────────────────────────────────────────────

export function createEmailProvider(providerName: string): EmailProvider {
  switch (providerName) {
    case "aws-ses":
    case "sendgrid":
      // TODO: implement native SDK adapters
    default:
      return new SmtpEmailProvider();
  }
}
