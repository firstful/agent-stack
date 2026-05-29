import { test, expect } from "@playwright/test"

test.describe("Add Provider Wizard", () => {
  test("navigates through all 5 steps and renders the correct UI", async ({ page }) => {
    // Mock external endpoints *before* navigating so the on-load fetches are intercepted
    await page.route("**/test-provider", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          models: [
            { id: "gpt-4o", owned_by: "openai" },
            { id: "gpt-4o-mini", owned_by: "openai" },
          ],
        }),
      })
    })

    await page.route("**/test-chat", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, response: "pong" }),
      })
    })

    await page.route("**/register", async (route) => {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          token: "test-token-123",
          label: "test-provider",
          provider: "openai",
          default_model: "gpt-4o",
          models: ["gpt-4o", "gpt-4o-mini"],
        }),
      })
    })

    await page.goto("/add-provider", { waitUntil: "networkidle" })

    // Wait for Alpine.js to boot and apply its bindings
    await page.waitForFunction(() => document.querySelector(".wizard-steps .step.active") !== null)

    // ── Step 1: Type ──
    await expect(page.locator(".wizard-steps .step.active")).toHaveText("1. Type")
    await expect(page.locator("text=Select Provider Type")).toBeVisible()

    // Select "OpenAI Compatible"
    await page.locator(".type-option", { hasText: "OpenAI Compatible" }).click()
    await expect(page.locator(".type-option.selected")).toContainText("OpenAI Compatible")

    // Move to Step 2
    await page.locator(".card:has-text('Select Provider Type') button:has-text('Next')").click()
    await expect(page.locator(".wizard-steps .step.active")).toHaveText("2. Connect")

    // ── Step 2: Connect ──
    await expect(page.locator("h2", { hasText: "Connection" })).toBeVisible()
    await page.locator('input[placeholder*="api.openai.com"]').fill("https://api.openai.com/v1")
    await page.locator('input[type="password"]').fill("sk-test-key")

    // The "Test Connection" button should be enabled now
    const testBtn = page.locator("button", { hasText: /Test Connection/ })
    await expect(testBtn).toBeEnabled()

    // Go back and forward to ensure state is preserved
    await page.locator(".card:has-text('Connection') button:has-text('Back')").click()
    await expect(page.locator(".wizard-steps .step.active")).toHaveText("1. Type")
    await page.locator(".card:has-text('Select Provider Type') button:has-text('Next')").click()
    await expect(page.locator(".wizard-steps .step.active")).toHaveText("2. Connect")

    // Input values should persist (Alpine x-model)
    await expect(page.locator('input[placeholder*="api.openai.com"]')).toHaveValue("https://api.openai.com/v1")
    await expect(page.locator('input[type="password"]')).toHaveValue("sk-test-key")

    await testBtn.click()
    await expect(page.locator("text=Connected")).toBeVisible()

    // Next button should now be enabled
    await page.locator(".card:has-text('Connection') button:has-text('Next')").click()
    await expect(page.locator(".wizard-steps .step.active")).toHaveText("3. Models")

    // ── Step 3: Models ──
    await expect(page.locator("text=Select Models")).toBeVisible()
    await expect(page.locator(".model-row")).toHaveCount(2)

    // First model is auto-selected by testConnection()
    await page.locator(".card:has-text('Select Models') button:has-text('Next')").click()
    await expect(page.locator(".wizard-steps .step.active")).toHaveText("4. Validate")

    // ── Step 4: Validate Chat ──
    await expect(page.locator("text=Validate Chat Endpoint")).toBeVisible()
    await expect(page.locator("text=Say 'pong' and nothing else.")).toBeVisible()

    await page.locator("button", { hasText: /Send Test/ }).click()
    await expect(page.locator(".chat-bubble.assistant", { hasText: "pong" })).toBeVisible()
    await expect(page.locator("text=Chat works")).toBeVisible()

    await page.locator(".card:has-text('Validate Chat Endpoint') button:has-text('Next')").click()
    await expect(page.locator(".wizard-steps .step.active")).toHaveText("5. Save")

    // ── Step 5: Save ──
    await expect(page.locator("h2", { hasText: "Save Provider" })).toBeVisible()
    await expect(page.locator(".card:has-text('Save Provider') .summary-row", { hasText: "Type: openai" })).toBeVisible()
    await expect(page.locator(".card:has-text('Save Provider') .summary-row", { hasText: "URL: https://api.openai.com/v1" })).toBeVisible()

    await page.locator('input[placeholder*="e.g. openai"]').fill("test-provider")
    await page.locator("button", { hasText: /Save Provider/ }).click()

    // After save we should be back at step 1 and see a toast
    await expect(page.locator(".wizard-steps .step.active")).toHaveText("1. Type")
  })

  test("existing providers table loads on step 1", async ({ page }) => {
    // Mock /providers so the table has data
    await page.route("**/providers", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          providers: [
            {
              label: "openai",
              providerType: "openai",
              defaultModel: "gpt-4o",
              baseUrl: "https://api.openai.com/v1",
            },
          ],
        }),
      })
    })

    await page.goto("/add-provider", { waitUntil: "networkidle" })

    // Wait for Alpine to finish loading and render the table
    await page.waitForFunction(() => {
      const table = document.querySelector("table")
      return table && window.getComputedStyle(table).display !== "none"
    })

    await expect(page.locator("td.provider-label", { hasText: "openai" })).toBeVisible()
    await expect(page.locator("td.truncate", { hasText: "gpt-4o" })).toBeVisible()
  })
})
