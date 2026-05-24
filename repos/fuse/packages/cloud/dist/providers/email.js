/**
 * providers/email.ts — transactional email provider adapters.
 *
 * Magic links, invites, and system notifications are sent through
 * whichever provider is configured.  Falls back to direct SMTP.
 */
// ── SMTP (generic) ───────────────────────────────────────────────────────
class SmtpEmailProvider {
    async sendMagicLink(to, link) {
        // TODO: implement SMTP client (or use nodemailer/simplesmtp)
        console.log(`[email] Magic link to ${to}: ${link}`);
    }
    async sendInvite(to, from, orgName) {
        // TODO: implement SMTP client
        console.log(`[email] Invite ${to} from ${from} to ${orgName}`);
    }
}
// ── Factory ──────────────────────────────────────────────────────────────
export function createEmailProvider(providerName) {
    switch (providerName) {
        case "aws-ses":
        case "sendgrid":
        // TODO: implement native SDK adapters
        default:
            return new SmtpEmailProvider();
    }
}
//# sourceMappingURL=email.js.map