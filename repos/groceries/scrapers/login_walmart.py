#!/usr/bin/env python3
"""Walmart scraper — uses undetected-chromedriver to bypass bot detection.

Reuses saved cookies if available, otherwise opens headed browser for login.
"""

import os
import sys
import time
import json
import logging
import pickle

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("walmart")

os.environ["DISPLAY"] = ":1"
os.environ["XAUTHORITY"] = "/run/user/1000/xauth_fEFHsn"

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CREDS_FILE = os.path.join(BASE, "profiles", "credentials.json")
COOKIES_FILE = os.path.join(BASE, "profiles", "walmart", "cookies.pkl")
ORDERS_OUT = os.path.join(BASE, "data", "walmart_orders.json")
DATA_DIR = os.path.join(BASE, "data")


def load_creds():
    if not os.path.exists(CREDS_FILE):
        sys.path.insert(0, os.path.join(BASE, "profiles"))
        from export_creds import export
        export()
    with open(CREDS_FILE) as f:
        return json.load(f).get("walmart", {})


def save_cookies(driver):
    os.makedirs(os.path.dirname(COOKIES_FILE), exist_ok=True)
    with open(COOKIES_FILE, "wb") as f:
        pickle.dump(driver.get_cookies(), f)
    logger.info(f"Cookies saved ({len(driver.get_cookies())})")


def load_cookies(driver, url="https://www.walmart.com"):
    if os.path.exists(COOKIES_FILE):
        driver.get(url)
        time.sleep(2)
        with open(COOKIES_FILE, "rb") as f:
            cookies = pickle.load(f)
        for c in cookies:
            try:
                driver.add_cookie(c)
            except Exception:
                pass
        logger.info(f"Loaded {len(cookies)} cookies")
        return True
    return False


def main():
    import sys
    otp_code = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1].isdigit() and len(sys.argv[1]) >= 4 else None
    if otp_code:
        logger.info(f"2FA code provided: {otp_code}")
    wc = load_creds()
    username, password = wc.get("user", ""), wc.get("pass", "")
    if not username:
        logger.error("No Walmart creds. Run: python3 creds.py set walmart")
        sys.exit(1)

    logger.info(f"Walmart: {username}")

    # Patch distutils for Python 3.14 compatibility
    import sys, types, re
    class CompatVersion:
        def __init__(self, vstring):
            self.vstring = str(vstring)
            components = re.findall(r'\d+', self.vstring)
            self.version = tuple(int(c) for c in components) if components else (0,)
        def __getitem__(self, idx):
            return self.version[idx] if idx < len(self.version) else 0

    distutils = types.ModuleType('distutils')
    distutils.version = types.ModuleType('distutils.version')
    distutils.version.LooseVersion = CompatVersion
    sys.modules['distutils'] = distutils
    sys.modules['distutils.version'] = distutils.version

    import undetected_chromedriver as uc
    from selenium.webdriver.support.ui import WebDriverWait

    options = uc.ChromeOptions()
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-gpu")
    options.add_argument(f"--window-size=1280,900")

    driver = uc.Chrome(options=options, version_main=149)
    driver.implicitly_wait(10)
    wait = WebDriverWait(driver, 15)

    try:
        # Try saved cookies
        if load_cookies(driver, "https://www.walmart.com"):
            driver.get("https://www.walmart.com/orders")
            time.sleep(3)
            if "login" not in driver.current_url.lower() and "blocked" not in driver.current_url.lower():
                logger.info("✅ Cookies work!")
                orders = scrape_orders_selenium(driver)
                save_orders(orders)
                return

        # ── LOGIN ──────────────────────────────────────────────────
        logger.info("Need fresh login")
        driver.get("https://www.walmart.com/account/login")
        time.sleep(3)

        # Check if already logged in
        if "Sign Out" in driver.page_source:
            logger.info("✅ Already logged in")
            save_cookies(driver)
            driver.get("https://www.walmart.com/orders")
            time.sleep(3)
            orders = scrape_orders_selenium(driver)
            save_orders(orders)
            return

        # Fill email
        try:
            email_input = wait.until(
                lambda d: d.find_element("css selector", "input[name='userName']")
            )
            email_input.send_keys(username)
            logger.info("✅ Email filled")
        except Exception:
            for inp in driver.find_elements("css selector", "input:not([type='hidden'])"):
                if inp.is_displayed():
                    inp.send_keys(username)
                    break
            logger.info("✅ Email filled (fallback)")

        time.sleep(1)

        try:
            driver.find_element("css selector", "button[type='submit']").click()
            logger.info("✅ Clicked Continue")
        except Exception:
            pass

        time.sleep(4)

        # Password or verification
        pw_filled = False
        for _ in range(8):
            try:
                pi = driver.find_element("css selector", "input[type='password']")
                if pi.is_displayed():
                    pi.send_keys(password)
                    pw_filled = True
                    time.sleep(1)
                    driver.find_element("css selector", "button[type='submit']").click()
                    logger.info("✅ Password submitted")
                    break
            except Exception:
                time.sleep(2)

        if not pw_filled:
            logger.info("ℹ️  Phone verification")
            try:
                btn = driver.find_element("css selector", "button[type='submit']")
                if btn.is_displayed():
                    btn.click()
                    logger.info("✅ Code requested")
            except Exception:
                pass

        # ── OTP entry ─────────────────────────────────────────────
        if otp_code and not pw_filled:
            logger.info(f"Looking for OTP field to enter code {otp_code}...")
            from selenium.webdriver.common.by import By
            from selenium.webdriver.support import expected_conditions as EC
            for attempt in range(15):
                try:
                    # Try standard OTP fields
                    otp_field = WebDriverWait(driver, 3).until(
                        EC.presence_of_element_located((By.CSS_SELECTOR,
                            "input[autocomplete='one-time-code'], input[inputmode='numeric'], input[type='tel']"))
                    )
                    if otp_field.is_displayed():
                        otp_field.send_keys(otp_code)
                        logger.info("✅ OTP entered via field")
                        time.sleep(1)
                        driver.find_element(By.CSS_SELECTOR, "button[type='submit']").click()
                        logger.info("✅ OTP submitted")
                        break
                except Exception:
                    pass

                # Try digit boxes
                try:
                    digits = driver.find_elements(By.CSS_SELECTOR, "input[maxlength='1']")
                    visible = [d for d in digits if d.is_displayed()]
                    if len(visible) >= 4:
                        for i, d in enumerate(visible[:6]):
                            if i < len(otp_code):
                                d.send_keys(otp_code[i])
                                time.sleep(0.1)
                        logger.info("✅ OTP via digit boxes")
                        time.sleep(1)
                        driver.find_element(By.CSS_SELECTOR, "button[type='submit']").click()
                        logger.info("✅ OTP submitted")
                        break
                except Exception:
                    pass

                logger.info(f"Waiting for OTP field ({attempt+1})...")
                time.sleep(2)

        print("\n" + "=" * 60)
        print("  BROWSER OPEN ON YOUR DESKTOP")
        print("  Complete verification in the browser window.")
        print("  Will auto-detect login and scrape.")
        print("=" * 60 + "\n")

        # Wait for login
        start = time.time()
        logged_in = False
        while time.time() - start < 300:
            try:
                cur = driver.current_url
                body = driver.page_source
                if "Sign Out" in body:
                    logged_in = True
                    break
                if "walmart.com" in cur and not any(x in cur.lower() for x in ["identity", "login", "signin", "blocked"]):
                    if "orders" in cur or "account" in cur or cur in ["https://www.walmart.com/", "https://www.walmart.com/orders"]:
                        logged_in = True
                        break
                rem = int(300 - (time.time() - start))
                if rem % 30 == 0:
                    logger.info(f"⏳ {rem}s left...")
            except Exception:
                pass
            time.sleep(3)

        if logged_in:
            logger.info("✅ Logged in!")
            save_cookies(driver)
            driver.get("https://www.walmart.com/orders")
            time.sleep(3)
            orders = scrape_orders_selenium(driver)
            save_orders(orders)
        else:
            logger.warning("⚠️  Login timeout")
            driver.save_screenshot(os.path.join(DATA_DIR, "walmart_timeout.png"))

    finally:
        driver.quit()
    logger.info("Done.")


def scrape_orders_selenium(driver):
    """Scrape orders using Selenium."""
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC

    orders = []
    for pn in range(10):
        logger.info(f"Page {pn+1}...")
        time.sleep(3)

        cards = driver.find_elements(By.CSS_SELECTOR, "[data-testid='order-card'], [class*='order-card']")
        old = len(orders)
        for card in cards:
            try:
                text = card.text
                links = card.find_elements(By.TAG_NAME, "a")
                order_link = None
                for link in links:
                    href = link.get_attribute("href") or ""
                    if "/orders/" in href:
                        order_link = href
                        break
                order_id = order_link.split("/orders/")[1].split("?")[0] if order_link else ""

                import re
                date_m = re.search(r"\w+ \d+,? \d{4}", text)
                total_m = re.search(r"\$(\d+\.?\d*)", text)

                if order_id:
                    orders.append({
                        "store": "walmart",
                        "order_id": order_id,
                        "order_date": date_m.group(0) if date_m else "",
                        "total": float(total_m.group(1)) if total_m else None,
                        "items": [],
                        "item_count": 0,
                    })
            except Exception:
                pass

        logger.info(f"  +{len(orders)-old} (total {len(orders)})")
        if len(orders) >= 500:
            break

        # Next page
        try:
            nb = driver.find_element(By.CSS_SELECTOR, "a[aria-label='Next Page'], button[aria-label='Next'], a:has-text('Next')")
            if nb.is_displayed():
                nb.click()
                time.sleep(3)
            else:
                break
        except Exception:
            break

    return orders


def save_orders(orders):
    os.makedirs(os.path.dirname(ORDERS_OUT), exist_ok=True)
    with open(ORDERS_OUT, "w") as f:
        json.dump(orders, f, indent=2)
    logger.info(f"✅ Saved {len(orders)} orders to {ORDERS_OUT}")


if __name__ == "__main__":
    main()
