# Groceries FFILT.US

A web application that serves historical order information from multiple grocery merchants, routinely scrapes orders to keep history up to date, and helps plan shopping trips.

## How It Works

**One human is the real user of five different grocery services. This app is their personal assistant.** It keeps a unified record of everything they've bought, what things cost across merchants, and what needs restocking.

### Automations

The web app has a set of automation entry points that it manages with an **internal task queue** — no external cron, no Hermes, no third-party scheduler. The queue is DB-backed (`scrape_tasks` table) with a background worker thread that polls every 15 seconds.

Each automation:

- Opens a **real Chromium browser on a real desktop display** (XWayland :1).
- Uses a **persistent Chromium profile** per merchant so session cookies, local storage, and login state survive across runs. Most of the time the scraper is already signed in.
- Falls back to stored credentials (user/pass + TOTP secrets) from **Vault** when a session expires.
- Operates **from the same network** as the real human user, behind the same NAT, with the same browser fingerprint — avoiding bot detection entirely.

### Architecture

```
                   ┌──────────────────────┐
                   │   FastAPI Web App     │
                   │  (port 8080)          │
                   │                       │
                   │  ┌─────────────────┐  │
                   │  │  Task Queue      │  │
                   │  │  (bg thread)     │  │
                   │  └──────┬──────────┘  │
                   │         │ spawns      │
                   │         ▼              │
                   │  ┌─────────────────┐  │
                   │  │  run_task.py     │  │
                   │  │  (subprocess)    │  │
                   │  └──────┬──────────┘  │
                   └─────────┼──────────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
        ┌──────────┐  ┌──────────┐  ┌──────────┐
        │ Chromium │  │ Kroger   │  │ Amazon   │
        │ (Walmart)│  │ REST API │  │ (TOTP)   │
        │ (Sam's)  │  │ + Play-  │  │ Playwright│
        │ (ALDI)   │  │ wright   │  │          │
        └──────────┘  └──────────┘  └──────────┘
              │              │              │
              ▼              ▼              ▼
        ┌──────────────────────────────────────┐
        │          SQLite (grocery.db)          │
        │  orders · items · prices · tasks     │
        └──────────────────────────────────────┘
```

Scrapers run in **isolated subprocesses** (`run_task.py merchant orders|prices`) so Playwright's synchronous API never conflicts with FastAPI's asyncio event loop.

### Merchants

| Merchant | Orders | Prices | Auth Method |
|---|---|---|---|
| **Amazon** | ✅ Playwright | ✅ Playwright | Email + password + TOTP (auto-filled) |
| **Kroger** | ✅ Playwright | ✅ Public API (OAuth2) | Email + password playwrite session |
| **Walmart** | ⏳ Pending | ⏳ Pending | Email + password + 2FA |
| **Sam's Club** | ⏳ Pending | ⏳ Pending | Email + password + DataDome CAPTCHA |
| **ALDI** | ⏳ Pending | ⏳ Pending | Email + password (Instacart platform) |

### Dashboard

A tabbed web dashboard served at the root path:

- **Summary** — live worker status, queue depth, last run times
- **Unified Orders** — chronological order history from all merchants with merchant badges and method indicators (Pickup, Delivery, Shipped, In-Store, Fuel)
- **Price Comparison** — ranked table with best-deal highlighting per item
- **Forecast** — outage prediction based on order cadence

### API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Dashboard (HTML) |
| `GET` | `/health` | Health check |
| `GET` | `/api/orders/unified` | Chronological orders from all merchants |
| `GET` | `/api/prices` | Current prices with best-price comparison |
| `GET` | `/api/search?q=...` | Full-text search across past orders |
| `GET` | `/api/queue/status` | Worker state, last/next run |
| `GET` | `/api/queue/tasks` | Task history (filterable) |
| `POST` | `/api/queue/trigger` | Trigger full scrape |
| `POST` | `/api/queue/trigger/{merchant}` | Trigger single merchant |

## Quick Start

```bash
# Install dependencies
uv pip install -r requirements.txt
playwright install chromium

# Export credentials from Vault
python3 creds.py export

# Start the web app
uvicorn web.app:app --host 0.0.0.0 --port 8080
```

The app listens on `http://0.0.0.0:8080`. The dashboard auto-polls worker status every 3 seconds.

## Configuration

Credentials live in **Vault** (key-value store scoped to `groceries/`), never on disk in plain text.

| Vault Key | Purpose |
|---|---|
| `GROCERIES_{SITE}_USER` | Username / email |
| `GROCERIES_{SITE}_PASS` | Password |
| `GROCERIES_{SITE}_TOTP` | TOTP secret key (Amazon only) |
| `GROCERIES_KROGER_CLIENT_ID` | Kroger Public API client ID |
| `GROCERIES_KROGER_CLIENT_SECRET` | Kroger Public API client secret |

The export command (`python3 creds.py export`) resolves plaintext values from Vault's
`/api/secrets/plain/groceries` endpoint and writes them to `profiles/credentials.json`
with `chmod 600`.

## Scrape Schedule

The scheduler runs every **2 hours** by default (configurable via `SCRAPE_INTERVAL_HOURS`).
On boot it queues an immediate full scrape of all configured merchants.

## Tech Stack

- **Python 3.14** — FastAPI, SQLAlchemy, Playwright, pyotp
- **SQLite** — single-file database at `data/grocery.db`
- **Chromium** — system-installed, launched on real display :1
- **Vault** — credential storage (agent-stack controller proxy)
- **agent-stack** — blue-green deployment, TLS tunnel via `groceries.ffilt.us`
