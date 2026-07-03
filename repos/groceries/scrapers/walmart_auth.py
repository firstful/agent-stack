#!/usr/bin/env python3
"""Walmart scraper — login + scrape using system Chromium.

Uses channel='chromium' (system-installed Chromium 149) which doesn't
trigger Walmart's bot detection. Supports:
  1. Headless login with OTP
  2. Session persistence
  3. Order scraping

Usage:
    # Fresh login (opens headed browser)
    .venv/bin/python3 scrapers/walmart_auth.py

    # Login with known OTP code
    .venv/bin/python3 scrapers/walmart_auth.py 265621

    # Reuse stored session (headless, no browser visible)
    .venv/bin/python3 scrapers/walmart_auth.py --headless

    # Just scrape orders using saved session
    .venv/bin/python3 scrapers/walmart_auth.py --scrape-only
"""

import os
import sys
import time
import json
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("walmart")

os.environ["DISPLAY"] = ":1"
os.environ["XAUTHORITY"] = "/run/user/1000/xauth_fEFHsn"

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROFILES_DIR = os.path.join(PROJECT_DIR, "profiles")
CREDS_FILE = os.path.join(PROFILES_DIR, "credentials.json")
STORAGE_STATE = os.path.join(PROFILES_DIR, "walmart", "storage_state.json")
ORDERS_OUTPUT = os.path.join(PROJECT_DIR, "data", "walmart_orders.json")


def load_creds() -> dict | None:
    if not os.path.exists(CREDS_FILE):
        logger.info("Exporting creds from vault...")
        sys.path.insert(0, PROFILES_DIR)
        from export_creds import export
        export()
    with open(CREDS_FILE) as f:
        return json.load(f).get("walmart")


def scrape_orders(page) -> list[dict]:
    """Scrape Walmart orders."""
    orders = []
    for pn in range(10):
        logger.info(f"Orders page {pn + 1}...")
        # Wait for cards
        try:
            page.wait_for_selector("[data-testid='order-card'], [class*='order']", timeout=8000)
        except Exception:
            pass
        time.sleep(2)

        cards = page.query_selector_all("[data-testid='order-card'], [class*='order-card']")
        old = len(orders)
        for card in cards:
            try:
                info = page.evaluate("""(c) => {
                    const t = c.innerText || '';
                    const links = [...c.querySelectorAll('a')].map(a => a.href);
                    const ol = links.find(l => l.includes('/orders/'));
                    const oid = ol ? ol.split('/orders/')[1]?.split('?')[0] : '';
                    const d = t.match(/\\w+ \\d+,? \\d{4}/);
                    const tot = t.match(/\\$(\\d+\\.?\\d*)/);
                    return { orderId: oid, date: d ? d[0] : '', total: tot ? tot[1] : null };
                }""", card)
                if info and info.get("orderId"):
                    orders.append({
                        "store": "walmart",
                        "order_id": info["orderId"],
                        "order_date": info.get("date", ""),
                        "total": float(info["total"]) if info.get("total") else None,
                        "items": [],
                        "item_count": 0,
                    })
            except Exception:
                pass

        logger.info(f"  Got {len(orders) - old} this page ({len(orders)} total)")
        if len(orders) >= 500:
            break

        # Next page
        try:
            nb = page.query_selector(
                "a[aria-label='Next Page'], button[aria-label='Next'], "
                "a:has-text('Next'), button:has-text('Next')"
            )
            if not nb or not nb.is_visible():
                break
            dis = nb.get_attribute("disabled") or ""
            if dis.lower() == "true":
                break
            nb.click()
            time.sleep(3)
            page.wait_for_load_state("networkidle", timeout=10000)
        except Exception:
            break

    return orders


def main():
    args = set(sys.argv[1:])
    otp_code = next((a for a in sys.argv[1:] if a.isdigit() and len(a) >= 4), None)
    scrape_only = "--scrape-only" in args
    headless = "--headless" in args or scrape_only

    from playwright.sync_api import sync_playwright

    # ── Load session if available ──────────────────────────────────────
    storage = None
    if os.path.exists(STORAGE_STATE):
        with open(STORAGE_STATE) as f:
            storage = json.load(f)
        logger.info(f"Loaded saved session ({len(storage.get('cookies',[]))} cookies)")

    # ── Launch browser ─────────────────────────────────────────────────
    with sync_playwright() as pw:
        b = pw.chromium.launch(
            channel="chromium",  # system Chromium — avoids bot detection
            headless=headless,
            args=["--no-sandbox", "--disable-blink-features=AutomationControlled"],
        )
        ctx = b.new_context(
            storage_state=storage,
            user_agent=(
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1280, "height": 900},
            locale="en-US",
            timezone_id="America/New_York",
        )
        page = ctx.new_page()

        # Stealth
        page.add_init_script("""
        delete Object.getOwnPropertyDescriptor(navigator.__proto__, 'webdriver');
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        window.chrome = { runtime: {} };
        """)

        # ── SCENARIO: scrape-only ───────────────────────────────────
        if scrape_only:
            logger.info("Scrape-only mode — navigating to orders...")
            try:
                page.goto("https://www.walmart.com/orders", wait_until="domcontentloaded", timeout=20000)
            except Exception:
                pass
            time.sleep(3)
            if "blocked" in page.url.lower() or "login" in page.url.lower():
                logger.warning("Session expired — need fresh login")
                page.screenshot(path=os.path.join(PROJECT_DIR, "data", "walmart_session_expired.png"))
            else:
                orders = scrape_orders(page)
                save_orders(orders, ORDERS_OUTPUT)
                logger.info(f"Scraped {len(orders)} orders")
            b.close()
            return

        # ── Check if existing session works ─────────────────────────
        if storage:
            logger.info("Testing saved session...")
            try:
                page.goto("https://www.walmart.com/orders", wait_until="domcontentloaded", timeout=20000)
            except Exception:
                pass
            time.sleep(3)
            if "blocked" not in page.url.lower() and "login" not in page.url.lower():
                if "Sign Out" in page.content():
                    logger.info("✅ Session valid! Scraping...")
                    orders = scrape_orders(page)
                    save_orders(orders, ORDERS_OUTPUT)
                    b.close()
                    return

            logger.info("Session expired — re-logging in")

        # ── Fresh login ──────────────────────────────────────────────
        wc = load_creds()
        if not wc or not wc.get("user"):
            logger.error("No Walmart credentials. Run: python3 creds.py set walmart")
            b.close()
            sys.exit(1)

        username, password = wc["user"], wc.get("pass", "")
        logger.info(f"Logging in as {username}")

        # Navigate to login
        page.goto("https://www.walmart.com/account/login", wait_until="domcontentloaded", timeout=30000)
        time.sleep(2)
        logger.info(f"URL: {page.url}")

        if "blocked" in page.url.lower():
            logger.error("Blocked! Trying with non-headless...")
            b.close()
            # Retry with headed browser
            b = pw.chromium.launch(
                channel="chromium",
                headless=False,
                args=["--no-sandbox", "--disable-blink-features=AutomationControlled"],
            )
            ctx = b.new_context(
                user_agent="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
                viewport={"width": 1280, "height": 900},
            )
            page = ctx.new_page()
            page.goto("https://www.walmart.com/account/login", wait_until="domcontentloaded", timeout=30000)
            time.sleep(2)
            if "blocked" in page.url.lower():
                logger.error("Still blocked in headed mode")
                page.screenshot(path=os.path.join(PROJECT_DIR, "data", "walmart_blocked.png"))
                b.close()
                sys.exit(1)

        logger.info("✅ Not blocked")

        # Fill email
        for sel in ["input[name='userName']", "input[autocomplete='username']", "input:not([type='hidden']):not([type='search'])"]:
            try:
                inp = page.wait_for_selector(sel, timeout=3000)
                if inp and inp.is_visible():
                    inp.click()
                    inp.fill(username)
                    logger.info("✅ Email entered")
                    break
            except Exception:
                continue

        time.sleep(1)
        try:
            page.click("button[type='submit']")
            logger.info("✅ Clicked Continue")
        except Exception:
            pass
        time.sleep(4)
        logger.info(f"After Continue: {page.url}")

        # Password or phone verification
        pw_filled = False
        for _ in range(8):
            try:
                pi = page.wait_for_selector("input[type='password']", timeout=3000)
                if pi and pi.is_visible() and password:
                    pi.click()
                    pi.fill(password)
                    logger.info("✅ Password filled")
                    pw_filled = True
                    time.sleep(1)
                    try:
                        page.click("button[type='submit']")
                        logger.info("✅ Clicked Sign In")
                    except Exception:
                        pass
                    break
            except Exception:
                time.sleep(2)

        # OTP flow
        if not pw_filled:
            logger.info("No password field — phone verification")
            try:
                sb = page.query_selector("button[type='submit']")
                if sb and sb.is_visible():
                    txt = sb.inner_text().lower()
                    if "text" in txt or "send" in txt or "code" in txt:
                        sb.click()
                        logger.info("✅ Sent code")
                        time.sleep(3)
            except Exception:
                pass

            if otp_code:
                for attempt in range(10):
                    # Combined field
                    of = None
                    for sel in ["input[autocomplete='one-time-code']", "input[inputmode='numeric']", "input[type='tel']"]:
                        try:
                            c = page.wait_for_selector(sel, timeout=2000)
                            if c and c.is_visible():
                                of = c
                                break
                        except Exception:
                            continue

                    if not of:
                        digs = [d for d in page.query_selector_all("input[maxlength='1']") if d.is_visible()]
                        if len(digs) >= 4:
                            for i, d in enumerate(digs[:6]):
                                if i < len(otp_code):
                                    d.click()
                                    d.fill(otp_code[i])
                                    time.sleep(0.1)
                            logger.info("✅ OTP via digit boxes")
                            time.sleep(1)
                            try:
                                page.click("button[type='submit']")
                                logger.info("✅ OTP submitted")
                            except Exception:
                                pass
                            break

                    if of:
                        of.click()
                        of.fill(otp_code)
                        logger.info("✅ OTP entered")
                        time.sleep(1)
                        try:
                            page.click("button[type='submit']")
                            logger.info("✅ OTP submitted")
                        except Exception:
                            pass
                        break

                    logger.info(f"Waiting for OTP ({attempt+1})...")
                    time.sleep(2)
            else:
                logger.info("No OTP code — waiting 2 min for manual entry")
                time.sleep(120)

        # Wait for login
        logger.info("Waiting for login completion...")
        start = time.time()
        timeout = 180
        logged_in = False
        while time.time() - start < timeout:
            try:
                cur, body = page.url, page.content()
                if "Sign Out" in body:
                    logged_in = True
                    logger.info(f"✅ Login at {cur}")
                    break
                if "walmart.com" in cur and not any(x in cur.lower() for x in ["identity", "login", "signin", "blocked"]):
                    if "orders" in cur or "account" in cur or cur == "https://www.walmart.com/":
                        logged_in = True
                        logger.info(f"✅ Login via URL: {cur}")
                        break
            except Exception:
                pass
            time.sleep(2)

        # Save session
        ctx.storage_state(path=STORAGE_STATE)
        logger.info(f"Session saved to {STORAGE_STATE}")

        # Scrape orders
        if logged_in:
            logger.info("Scraping orders...")
            try:
                page.goto("https://www.walmart.com/orders", wait_until="domcontentloaded", timeout=20000)
            except Exception:
                pass
            time.sleep(5)
            orders = scrape_orders(page)
            save_orders(orders, ORDERS_OUTPUT)
            page.screenshot(path=os.path.join(PROJECT_DIR, "data", "walmart_orders.png"))
        else:
            logger.warning("Login not detected")
            page.screenshot(path=os.path.join(PROJECT_DIR, "data", "walmart_fail.png"))

        b.close()
        logger.info("Done.")


def save_orders(orders, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(orders, f, indent=2)
    logger.info(f"Saved {len(orders)} orders to {path}")


if __name__ == "__main__":
    main()
