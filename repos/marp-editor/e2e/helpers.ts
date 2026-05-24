import type { Page } from '@playwright/test'
import { test } from '@playwright/test'
import type { TestLlmResponse } from '../server/llm-test'

/** Reset LLM and set deterministic responses for a test */
export async function setLlmResponses(page: Page, responses: TestLlmResponse[]) {
  await page.request.post('/api/test/reset')
  const r = await page.request.post('/api/test/set-llm-responses', {
    data: { responses },
  })
  if (!r.ok()) throw new Error(`Failed to set LLM responses: ${await r.text()}`)
}

/** Check test mode is active */
export async function ensureTestMode(page: Page) {
  const r = await page.request.get('/api/test/status')
  if (!r.ok()) throw new Error('Server not in TEST_MODE — set TEST_MODE=1')
}

/** Wait for n slides to appear in the DOM */
export async function waitForSlideCount(page: Page, count: number) {
  await page.waitForFunction(
    (expected) => {
      const el = document.querySelector('[class*="marp-slide"]')
      if (!el) return false
      const text = document.body.textContent || ''
      const slideMatch = text.match(/Slide (\d+) of (\d+)/)
      return slideMatch && parseInt(slideMatch[2]) === expected
    },
    count,
    { timeout: 5000 }
  )
}

/** Get current slide count from the navigator */
export async function getSlideCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const text = document.body.textContent || ''
    const m = text.match(/Slide (\d+) of (\d+)/)
    return m ? parseInt(m[2]) : 0
  })
}

/** Default markdown with 4 slides */
export const DEFAULT_MARKDOWN = `---
marp: true
theme: default
size: 16:9
paginate: true
---

# Welcome

Slide 1

---

## Features

Slide 2

---

## How To

Slide 3

---

## Get Started

Slide 4
`
