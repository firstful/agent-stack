# Groceries — Backlog

## Overview

Unified grocery order history and price comparison service. Scrapes orders from multiple merchants (Amazon, Kroger, Walmart, Sam's Club, ALDI) into a single SQLite database and provides a web dashboard for price comparison and shopping trip planning.

## Status

- **Completion**: 5/10 deliverables done
- **Phase/Stage**: Active development — Amazon and Kroger scrapers operational, dashboard serving. Walmart, Sam's Club, ALDI pending.
- **Last updated**: 2026-07-04

## Deliverables

### Scrapers (2/5 complete)
- [x] Amazon — Order history scraper via Playwright (email + password + TOTP)
- [x] Kroger — Orders + prices via Playwright + OAuth2 API
- [ ] Walmart — Orders/scraper (email + password + 2FA)
- [ ] Sam's Club — Orders/scraper (DataDome CAPTCHA)
- [ ] ALDI — Orders/scraper (Instacart platform)

### Dashboard (1/1 complete)
- [x] Tabbed web dashboard at root path with merchant views

### Price Comparison (1/2 complete)
- [x] Cross-merchant price comparison table
- [ ] Quantity-aware normalization for unit price comparison

### Task Queue (1/1 complete)
- [x] Interal DB-backed task queue with background worker (15s poll)

### Infrastructure (0/1 complete)
- [ ] Data sync to remote server (`sync-to-server.sh`)

## Open Questions / Blockers

- [ ] Walmart 2FA flow — needs investigation and automation
- [ ] Sam's Club DataDome CAPTCHA bypass — may require session cookie injection
- [ ] ALDI uses Instacart platform — different scraping strategy needed
- [ ] Data volume growth — SQLite may need eventual migration to Postgres

## Notes

- Uses persistent Chromium profiles per merchant for session survival
- Credentials from Vault fallback for expired sessions
- Runs behind host NAT with same browser fingerprint as real user (avoids bot detection)
- Running on groceries.ffilt.us (port 4000)
