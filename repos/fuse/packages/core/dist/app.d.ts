/**
 * app.ts — Express app factory.
 *
 * Exporting the app as a factory function (rather than a singleton) makes
 * testing trivial: individual tests create an isolated app with stubbed
 * dependencies and an ephemeral DB.
 *
 * Mount order:
 *   helmet → cors → json/urlencoded body parsers → query string parser →
 *   auth middleware (from src/auth/) → API router (createApiRouter) → error handler
 */
/**
 * createApp — builds and returns a fully wired Express application instance.
 * No route handlers are registered until `app` is called from `createApp`.
 */
export declare function createApp(): import("express").Express;
//# sourceMappingURL=app.d.ts.map