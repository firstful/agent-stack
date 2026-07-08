#!/usr/bin/env npx tsx
/**
 * build-talaria-apk.ts — Standalone APK build script for the Talaria Android service.
 *
 * Loads the talaria service definition from desired configs and delegates
 * the full APK build pipeline to reconcile.ts's ensureApkBuild() — which
 * clones the repo, runs Gradle, and deploys the output APK + OTA manifest.
 *
 * Usage: npx tsx build-talaria-apk.ts
 */

import { loadDesired } from "./lib/services";
import { ensureApkBuild } from "./lib/reconcile";

const talaria = loadDesired().find((s: any) => s.name === "talaria");
if (!talaria) {
  console.error("talaria not found");
  process.exit(1);
}
ensureApkBuild(talaria);
