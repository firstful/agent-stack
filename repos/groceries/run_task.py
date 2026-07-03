#!/usr/bin/env python3
"""
Standalone task runner — spawned as a subprocess by the web app
so Playwright's sync API doesn't conflict with FastAPI's asyncio loop.

Usage:
    python3 run_task.py <merchant> <task_type>

Reads credentials from profiles/credentials.json and writes result
to stdout as JSON: {"ok": true, "count": N, "items": [...]}
or {"ok": false, "error": "..."}
"""
import json
import sys
import os
import signal
import logging
import subprocess
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(levelname)s:%(name)s:%(message)s",
)

PROJECT_DIR = Path(__file__).resolve().parent
DATA_DIR = PROJECT_DIR / "data"
CREDS_FILE = PROJECT_DIR / "profiles" / "credentials.json"


def free_profile(merchant: str):
    """Kill any Chromium process using this merchant's profile directory."""
    profile_path = str(PROJECT_DIR / "profiles" / merchant / "chromium-profile")
    try:
        result = subprocess.run(
            ["pgrep", "-f", profile_path],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode == 0:
            pids = [int(p) for p in result.stdout.strip().split() if p]
            for pid in pids:
                try:
                    os.kill(pid, signal.SIGTERM)
                    logging.info("Killed stale Chromium (PID %d) for %s", pid, merchant)
                except (ProcessLookupError, OSError):
                    pass
            # Wait for them to die
            import time
            time.sleep(2)
            # Force kill any remaining
            for pid in pids:
                try:
                    os.kill(pid, signal.SIGKILL)
                except (ProcessLookupError, OSError):
                    pass
    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass


def load_creds(merchant: str) -> dict:
    with open(CREDS_FILE) as f:
        return json.load(f).get(merchant, {})


def run_orders(merchant: str, creds: dict) -> dict:
    free_profile(merchant)
    from scrapers import (
        WalmartScraper, SamsClubScraper, AmazonScraper,
        KrogerScraper, AldiScraper,
    )
    _MAP = {
        "walmart": WalmartScraper, "samsclub": SamsClubScraper,
        "amazon": AmazonScraper, "kroger": KrogerScraper, "aldi": AldiScraper,
    }
    from storage import get_engine, init_db, get_session, store_order

    cls = _MAP.get(merchant)
    if not cls:
        return {"ok": False, "error": f"No scraper for {merchant}"}

    engine = get_engine()
    init_db(engine)
    db = get_session(engine)

    orders = []
    try:
        with cls(headless=False) as scraper:
            if merchant == "amazon":
                scraper.login(
                    creds.get("user", ""),
                    creds.get("pass", ""),
                    totp_secret=creds.get("totp"),
                )
            else:
                scraper.login(creds.get("user", ""), creds.get("pass", ""))
            orders = scraper.scrape_orders(max_orders=50)
            for od in orders:
                store_order(db, merchant, od)
    finally:
        db.close()

    return {"ok": True, "count": len(orders), "orders": orders}


def run_prices(merchant: str, creds: dict) -> dict:
    free_profile(merchant)
    from scrapers import (
        WalmartScraper, SamsClubScraper, AmazonScraper,
        KrogerScraper, AldiScraper,
    )
    _MAP = {
        "walmart": WalmartScraper, "samsclub": SamsClubScraper,
        "amazon": AmazonScraper, "kroger": KrogerScraper, "aldi": AldiScraper,
    }

    cls = _MAP.get(merchant)
    if not cls:
        return {"ok": False, "error": f"No scraper for {merchant}"}

    items = []
    try:
        with cls(headless=False) as scraper:
            if merchant == "amazon":
                scraper.login(
                    creds.get("user", ""),
                    creds.get("pass", ""),
                    totp_secret=creds.get("totp"),
                )
            elif creds.get("user"):
                scraper.login(creds.get("user", ""), creds.get("pass", ""))
            items = scraper.scrape_current_prices(zip_code="43147")
    except Exception as e:
        # Most price scrapers don't need auth — try without login
        try:
            with cls(headless=False) as scraper:
                items = scraper.scrape_current_prices(zip_code="43147")
        except Exception as e2:
            return {"ok": False, "error": f"Login failed: {e}, scrape failed: {e2}"}

    # Merge into latest_prices.json
    output_path = DATA_DIR / "latest_prices.json"
    existing = []
    if output_path.exists():
        with open(output_path) as f:
            existing = json.load(f)
    existing = [p for p in existing if p.get("store") != merchant]
    existing.extend(items)
    with open(output_path, "w") as f:
        json.dump(existing, f, indent=2, default=str)

    return {"ok": True, "count": len(items), "items": items}


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"ok": False, "error": "Usage: run_task.py <merchant> <orders|prices>"}))
        sys.exit(1)

    merchant = sys.argv[1]
    task_type = sys.argv[2]
    creds = load_creds(merchant)

    if task_type == "orders":
        result = run_orders(merchant, creds)
    elif task_type == "prices":
        result = run_prices(merchant, creds)
    else:
        result = {"ok": False, "error": f"Unknown task type: {task_type}"}

    print(json.dumps(result))


if __name__ == "__main__":
    main()
