/**
 * pg Pool singleton.
 *
 * The pool is initialised once from environment variables and exported here for
 * use by every repository module.
 */
import pg from "pg";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let _pool = null;
/**
 * getPool — returns a lazily-initialised singleton pg Pool.
 *
 * @throws {Error} if DATABASE_URL is not set in the environment.
 */
export function getPool() {
    if (_pool)
        return _pool;
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        throw new Error("DATABASE_URL environment variable is not set. " +
            "Check .env or your deployment config.");
    }
    _pool = new pg.Pool({
        connectionString,
        max: 10,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
    });
    _pool.on("error", (err) => {
        // Forward pool errors to process so monitoring can pick them up.
        process.emit("warning", err);
    });
    return _pool;
}
/**
 * closePool — shuts down the pool gracefully. Safe to call multiple times.
 */
export async function closePool() {
    if (_pool) {
        await _pool.end();
        _pool = null;
    }
}
//# sourceMappingURL=pool.js.map