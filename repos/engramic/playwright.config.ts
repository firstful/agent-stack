import { defineConfig, devices } from "@playwright/test"

/**
 * Playwright E2E configuration for engramic wizard flows.
 *
 * By default tests run against the deployed instance at https://engramic.ffilt.us.
 * Set `BASE_URL=http://localhost:3001` to test a local build instead.
 *
 * Cloudflare Access service-token headers are injected on every request
 * so the browser can pass through the tunnel when hitting the deployed domain.
 *
 * Token values come from /srv/agent-stack/docs/cloudflare-access.md
 */
const BASE_URL = process.env.BASE_URL || "https://engramic.ffilt.us"

const isDeployed = BASE_URL.includes("ffilt.us")

const CF_ACCESS_CLIENT_ID =
  process.env.CF_ACCESS_CLIENT_ID ||
  "d2845237d9ac395bde2d9b946431742c.access"

const CF_ACCESS_CLIENT_SECRET =
  process.env.CF_ACCESS_CLIENT_SECRET ||
  "6aa475541cbe9c694b23cff57627da320f184975247fac2910307c519087ab86"

const extraHTTPHeaders: Record<string, string> = {}
if (isDeployed) {
  extraHTTPHeaders["CF-Access-Client-Id"] = CF_ACCESS_CLIENT_ID
  extraHTTPHeaders["CF-Access-Client-Secret"] = CF_ACCESS_CLIENT_SECRET
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "list",
  use: {
    baseURL: BASE_URL,
    extraHTTPHeaders,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
})
