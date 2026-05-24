/**
 * pg Pool singleton.
 *
 * The pool is initialised once from environment variables and exported here for
 * use by every repository module.
 */
import pg from "pg";
/**
 * getPool — returns a lazily-initialised singleton pg Pool.
 *
 * @throws {Error} if DATABASE_URL is not set in the environment.
 */
export declare function getPool(): pg.Pool;
/**
 * closePool — shuts down the pool gracefully. Safe to call multiple times.
 */
export declare function closePool(): Promise<void>;
//# sourceMappingURL=pool.d.ts.map