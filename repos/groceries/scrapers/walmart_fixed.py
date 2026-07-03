#!/usr/bin/env python3
"""Walmart scraper — fixed login flow for Walmart's identity OTP page.

Uses system Chromium (channel='chromium') to avoid bot detection.
Handles the email → OTP method selection → digit boxes → scrape pipeline.

Usage:
    python3 scrapers/walmart_fixed.py              # fresh headed login
    python3 scrapers/walmart_fixed.py 412272       # with OTP code
    python3 scrapers/walmart_fixed.py --scrape-only  # reuse saved session
"""

import os, sys, time, json, logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("walmart")

os.environ["DISPLAY"] = ":1"
os.environ["XAUTHORITY"] = "/run/user/1000/xauth_fEFHsn"

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROFILES_DIR = os.path.join(PROJECT_DIR, "profiles")
CREDS_FILE = os.path.join(PROFILES_DIR, "credentials.json")
STORAGE_STATE = os.path.join(PROFILES_DIR, "walmart", "storage_state.json")
ORDERS_OUTPUT = os.path.join(PROJECT_DIR, "data", "walmart_orders.json")


def load_creds():
    if not os.path.exists(CREDS_FILE):
        logger.info("Exporting creds from vault...")
        sys.path.insert(0, PROFILES_DIR)
        from export_creds import export
        export()
    with open(CREDS_FILE) as f:
        return json.load(f).get("walmart")


def scrape_orders(page) -> list[dict]:
    """Scrape Walmart orders page."""
    orders = []
    for pn in range(10):
        logger.info(f"Orders page {pn + 1}...")
        try:
            page.wait_for_selector("[data-testid='order-card'], [class*='order']", timeout=10000)
        except Exception:
            pass
        time.sleep(3)

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


def save_orders(orders, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(orders, f, indent=2)
    logger.info(f"Saved {len(orders)} orders to {path}")


def main():
    args = set(sys.argv[1:])
    otp_code = next((a for a in sys.argv[1:] if a.isdigit() and len(a) >= 4), None)
    scrape_only = "--scrape-only" in args
    headless = "--headless" in args or scrape_only

    from playwright.sync_api import sync_playwright

    # Load saved session
    storage = None
    if os.path.exists(STORAGE_STATE):
        with open(STORAGE_STATE) as f:
            storage = json.load(f)
        logger.info(f"Loaded saved session ({len(storage.get('cookies', []))} cookies)")

    with sync_playwright() as pw:

        def launch_browser(headless_mode):
            """Launch browser — system Chromium channel."""
            b = pw.chromium.launch(
                channel="chromium",
                headless=headless_mode,
                args=["--no-sandbox", "--disable-blink-features=AutomationControlled"],
            )
            ctx = b.new_context(
                storage_state=storage,
                user_agent=("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                            "(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"),
                viewport={"width": 1280, "height": 900},
                locale="en-US",
                timezone_id="America/New_York",
            )
            pg = ctx.new_page()
            pg.add_init_script("""\
delete Object.getOwnPropertyDescriptor(navigator.__proto__, 'webdriver');
Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
window.chrome = { runtime: {} };
""")
            return b, pg

        # ── Scrape-only mode ──────────────────────────────────────────
        if scrape_only:
            b, page = launch_browser(True)
            logger.info("Scrape-only mode — checking session...")
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
            b.close()
            return

        # ── Check saved session ──────────────────────────────────────
        if storage:
            b, page = launch_browser(True)
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
            b.close()
            logger.info("Session expired — re-logging in")

        # ── Fresh login (headed to avoid blocking) ────────────────────
        wc = load_creds()
        if not wc or not wc.get("user"):
            logger.error("No Walmart credentials. Run: python3 creds.py set walmart")
            sys.exit(1)

        username = wc["user"]

        b, page = launch_browser(False)  # headed

        # Homepage first to establish session
        page.goto("https://www.walmart.com", wait_until="domcontentloaded", timeout=30000)
        time.sleep(2)

        # Go to login
        logger.info(f"Logging in as {username}")
        page.goto("https://www.walmart.com/account/login", wait_until="domcontentloaded", timeout=30000)
        time.sleep(2)
        logger.info(f"URL: {page.url}")

        if "blocked" in page.url.lower():
            logger.warning("Blocked — retrying with fresh headed browser...")
            b.close()
            time.sleep(1)
            # Fresh browser, no saved session
            storage = None
            b, page = launch_browser(False)
            page.goto("https://www.walmart.com/account/login", wait_until="domcontentloaded", timeout=30000)
            time.sleep(2)
            logger.info(f"URL (retry): {page.url}")
            if "blocked" in page.url.lower():
                logger.error("Still blocked in headed mode!")
                page.screenshot(path=os.path.join(PROJECT_DIR, "data", "walmart_blocked.png"))
                b.close()
                sys.exit(1)

        # ── Step 1: Fill email ───────────────────────────────────────
        email_sel = "input[name='Phone number or email (required)']"
        try:
            inp = page.wait_for_selector(email_sel, timeout=8000)
            inp.fill(username)
            logger.info("✅ Email entered")
        except Exception:
            logger.error("Could not find email field")
            page.screenshot(path=os.path.join(PROJECT_DIR, "data", "walmart_no_email.png"))
            b.close()
            sys.exit(1)

        time.sleep(1)
        page.click("button[type='submit']")
        logger.info("✅ Clicked Continue")
        time.sleep(4)
        logger.info(f"After email: {page.url}")

        # ── Step 2: Select verification method ───────────────────────
        # Three radio buttons: otp (Text me), otpEmail, password
        password_radio = page.query_selector("input[name='password']")
        if password_radio and wc.get("pass"):
            # Use password — no SMS code needed
            logger.info("🔑 Using password verification")
            page.evaluate("(el) => el.click()", password_radio)
            time.sleep(0.5)

            # Click the password button
            pw_btn = page.query_selector("button:has-text('password'), button:has-text('Password')")
            if pw_btn:
                pw_btn.click()
                logger.info("✅ Clicked 'Use password'")
            else:
                # Try any submit button
                for btn in page.query_selector_all("button[type='submit']"):
                    if btn.is_visible():
                        btn.click()
                        logger.info("✅ Clicked submit button")
                        break
            time.sleep(3)

            # Fill password
            pw_input = None
            for sel in ["input[type='password']", "input[name='password']", "input[autocomplete='current-password']"]:
                try:
                    pi = page.wait_for_selector(sel, timeout=5000)
                    if pi and pi.is_visible():
                        pw_input = pi
                        break
                except Exception:
                    continue

            if pw_input:
                pw_input.click()
                pw_input.fill(wc.get("pass", ""))
                logger.info("✅ Password entered")
                time.sleep(1)

                # Click Sign In
                signin = page.query_selector("button[type='submit']")
                if signin:
                    signin.click()
                    logger.info("✅ Clicked Sign In")
                    time.sleep(3)
            else:
                logger.warning("Could not find password field — falling back to SMS")
                # Fall through to OTP code logic
        else:
            # SMS/OTP verification flow
            logger.info("📱 Using SMS verification")
            radio = page.query_selector("input[name='otp']")
            if radio:
                page.evaluate("(el) => el.click()", radio)
                time.sleep(0.5)
                logger.info("✅ Selected 'Text me' radio")

            sms_btn = page.query_selector("button:has-text('Text me')")
            if sms_btn:
                sms_btn.click()
                logger.info("✅ Clicked 'Text me'")
                time.sleep(3)
            else:
                logger.warning("No 'Text me' button found")

        logger.info(f"After method: {page.url}")
        page.screenshot(path=os.path.join(PROJECT_DIR, "data", "walmart_after_method.png"))

        # ── Step 3: Enter OTP code (if SMS was sent) ──────────────────
        if otp_code and not password_radio:
            logger.info(f"Entering OTP code: {otp_code}")
            for attempt in range(15):
                # Check for the 6 individual digit boxes
                digit_boxes = []
                for i in range(6):
                    box = page.query_selector(f"#input-verificationCode-{i}")
                    if box and page.evaluate("(el) => el.offsetParent !== null", box):
                        digit_boxes.append(box)

                if len(digit_boxes) >= 6:
                    for i, box in enumerate(digit_boxes[:6]):
                        if i < len(otp_code):
                            box.click()
                            box.fill(otp_code[i])
                            time.sleep(0.1)
                    logger.info("✅ OTP digits entered")
                    time.sleep(1)
                    break

                # Try combined field as fallback
                combined = page.query_selector("#input-verificationCode")
                if combined and page.evaluate("(el) => el.offsetParent !== null", combined):
                    combined.click()
                    combined.fill(otp_code)
                    logger.info("✅ OTP entered in combined field")
                    time.sleep(1)
                    break

                logger.info(f"Waiting for OTP fields ({attempt + 1})...")
                time.sleep(2)
        else:
            logger.info("No OTP code provided — waiting 120s for manual entry")
            time.sleep(120)

        # Click Sign in
        signin_btn = page.query_selector("button:has-text('Sign in')")
        if signin_btn:
            signin_btn.click()
            logger.info("✅ Clicked Sign in")
            time.sleep(3)

        # ── Step 4: Wait for login ───────────────────────────────────
        logger.info("Waiting for login completion...")
        start = time.time()
        timeout = 180
        logged_in = False
        while time.time() - start < timeout:
            try:
                cur, body = page.url, page.content()
                if "Sign Out" in body:
                    logged_in = True
                    logger.info(f"✅ Login confirmed at {cur}")
                    break
                if "walmart.com" in cur and not any(x in cur.lower() for x in ["identity", "login", "signin", "blocked"]):
                    if "orders" in cur or "account" in cur or cur == "https://www.walmart.com/":
                        logged_in = True
                        logger.info(f"✅ Login via URL: {cur}")
                        break
            except Exception:
                pass
            time.sleep(2)

        # Save session regardless — get context from current page
        try:
            ctx = page.context
            ctx.storage_state(path=STORAGE_STATE)
            logger.info("Session saved")
        except Exception as e:
            logger.warning(f"Could not save session: {e}")

        # ── Step 5: Scrape orders ────────────────────────────────────
        if logged_in:
            logger.info("✅ Navigating to orders...")
            try:
                page.goto("https://www.walmart.com/orders", wait_until="domcontentloaded", timeout=20000)
            except Exception:
                pass
            time.sleep(5)
            orders = scrape_orders(page)
            save_orders(orders, ORDERS_OUTPUT)
            page.screenshot(path=os.path.join(PROJECT_DIR, "data", "walmart_orders.png"))
        else:
            logger.warning("⚠️  Login not detected")
            page.screenshot(path=os.path.join(PROJECT_DIR, "data", "walmart_fail.png"))

        b.close()
    logger.info("Done.")


if __name__ == "__main__":
    main()
