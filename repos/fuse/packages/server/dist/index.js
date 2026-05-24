/**
 * @fuse/server — self-hosted single-tenant entrypoint.
 *
 * Starts all Fuse subsystems after auto-provisioning a single domain.
 * Designed to be run with `docker compose up` — zero manual config.
 */
import "dotenv/config";
import { bootstrap, gracefulShutdown, getPool, config } from "@fuse/core";
process.once("SIGTERM", () => void gracefulShutdown("SIGTERM"));
process.once("SIGINT", () => void gracefulShutdown("SIGINT"));
async function main() {
    // ── Auto-provision single domain ──────────────────────────────────────
    // In self-hosted mode there is always exactly one domain.  If none exists
    // on first boot, create one from the configured FUSE_DOMAIN env var.
    const pool = getPool();
    const { rows } = await pool.query("SELECT id FROM domains LIMIT 1");
    if (rows.length === 0) {
        const domain = config.FUSE_DOMAIN;
        console.log(`[server] No domain found — provisioning "${domain}"…`);
        await pool.query(`INSERT INTO domains (name, config, trust_level)
       VALUES ($1, '{}'::jsonb, 0)
       ON CONFLICT (name) DO NOTHING`, [domain]);
        console.log(`[server] Domain "${domain}" provisioned.`);
    }
    // ── Bootstrap core subsystems ─────────────────────────────────────────
    await bootstrap();
}
main().catch((error) => {
    console.error("[server] Failed:", error);
    process.exit(1);
});
//# sourceMappingURL=index.js.map