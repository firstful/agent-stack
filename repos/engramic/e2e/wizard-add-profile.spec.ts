import { test, expect } from "@playwright/test"

test.describe("Add Profile Wizard", () => {
  test("renders the profile form and validates required fields", async ({ page }) => {
    // Mock /providers *before* navigation so the init() fetch is intercepted
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
            {
              label: "deepseek",
              providerType: "openai",
              defaultModel: "deepseek-chat",
              baseUrl: "https://api.deepseek.com/v1",
            },
          ],
        }),
      })
    })

    await page.goto("/add-profile", { waitUntil: "networkidle" })

    // Wait for the form to render
    await expect(page.locator("text=Add Profile")).toBeVisible()
    await expect(page.locator("text=New Profile")).toBeVisible()

    // Wait for providers to load and the select to populate
    await page.waitForFunction(() => {
      const select = document.querySelector("select")
      return select && select.options.length > 0
    })

    const select = page.locator("select")
    await expect(select).toContainText("openai")
    await expect(select).toContainText("deepseek")

    // Default provider should be auto-selected (first item)
    await expect(select).toHaveValue("openai")

    // Save button should be disabled when name is empty
    const saveBtn = page.locator("button", { hasText: /Save Profile/ })
    await expect(saveBtn).toBeDisabled()

    // Fill in the name
    await page.locator('input[placeholder*="Default"]').fill("Test Profile")
    await expect(saveBtn).toBeEnabled()

    // Verify default model and context window values
    await expect(page.locator('input[placeholder*="gpt-4o"]').first()).toHaveValue("*")
    await expect(page.locator('input[type="number"]')).toHaveValue("128000")

    // Change the provider
    await select.selectOption("deepseek")
    await expect(select).toHaveValue("deepseek")
  })

  test("submits the form and redirects to dashboard", async ({ page }) => {
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

    await page.route("**/v1/profiles", async (route) => {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          id: "prof_123",
          name: "Fast",
          execution: { provider: "openai", model: "gpt-4o-mini" },
          summarization: { provider: "openai", model: "gpt-4o-mini" },
          embedding: { provider: "openai", model: "gpt-4o-mini" },
          contextWindow: 128000,
          compression: { trigger: "token_count", threshold: 80000, rate: "medium" },
          tools: [],
          modelPreferences: [],
        }),
      })
    })

    await page.goto("/add-profile", { waitUntil: "networkidle" })

    await page.waitForFunction(() => {
      const select = document.querySelector("select")
      return select && select.options.length > 0
    })

    // Fill out the form
    await page.locator('input[placeholder*="Default"]').fill("Fast")
    await page.locator('input[placeholder*="gpt-4o"]').first().fill("gpt-4o-mini")
    await page.locator('input[type="number"]').fill("64000")

    // Click Save
    await page.locator("button", { hasText: /Save Profile/ }).click()

    // Should redirect to dashboard (root "/")
    await page.waitForURL("/")
    await expect(page.locator("text=Dashboard")).toBeVisible()
  })

  test("cancel button returns to dashboard", async ({ page }) => {
    await page.goto("/add-profile", { waitUntil: "networkidle" })
    await page.locator("a", { hasText: /Cancel/ }).click()

    await page.waitForURL("/")
    await expect(page.locator("text=Dashboard")).toBeVisible()
  })
})
