#!/usr/bin/env python3
"""Kroger scraper — hybrid: REST API for prices, Playwright for orders.

Vault expects:
  - GROCERIES_KROGER_CLIENT_ID / GROCERIES_KROGER_CLIENT_SECRET (API)
  - GROCERIES_KROGER_USER / GROCERIES_KROGER_PASS (website login)

Price scraping uses the Kroger Public API (no browser needed).
Order scraping uses Playwright + system Chromium (headed for MFA).
"""

import os, sys, json, time, re, logging
from typing import Optional

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_DIR not in sys.path:
    sys.path.insert(0, PROJECT_DIR)

import requests as req
from scrapers.base import BaseScraper
from core import human_delay

logger = logging.getLogger(__name__)
PROFILES_DIR = os.path.join(PROJECT_DIR, "profiles")

# ─── API Token Management ───────────────────────────────────────────────

TOKEN_CACHE = None
TOKEN_EXPIRES = 0


def load_api_creds() -> dict:
    """Load Kroger API client credentials from Vault."""
    creds_file = os.path.join(PROFILES_DIR, "credentials.json")
    if not os.path.exists(creds_file):
        sys.path.insert(0, PROFILES_DIR)
        from export_creds import export
        export()
    with open(creds_file) as f:
        return json.load(f).get("kroger_client", {})


def get_token() -> str:
    """OAuth2 client_credentials token for Kroger Public API."""
    global TOKEN_CACHE, TOKEN_EXPIRES
    now = time.time()
    if TOKEN_CACHE and now < TOKEN_EXPIRES - 60:
        return TOKEN_CACHE
    creds = load_api_creds()
    cid, csec = creds.get("id", ""), creds.get("secret", "")
    if not cid or not csec:
        raise ValueError("Kroger API creds not in Vault")
    auth = req.auth.HTTPBasicAuth(cid, csec)
    resp = req.post(
        "https://api.kroger.com/v1/connect/oauth2/token",
        data={"grant_type": "client_credentials", "scope": "product.compact"},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        auth=auth, timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()
    TOKEN_CACHE = data["access_token"]
    TOKEN_EXPIRES = now + data.get("expires_in", 1800)
    return TOKEN_CACHE


def search_products(term: str = "", upc: str = "", location_id: str = "", limit: int = 5) -> list[dict]:
    """Search Kroger product catalog via Public API."""
    token = get_token()
    params = {"filter.limit": min(limit, 50)}
    if term:
        params["filter.term"] = term
    if upc:
        params["filter.upc"] = upc
    if location_id:
        params["filter.locationId"] = location_id
    resp = req.get(
        "https://api.kroger.com/v1/products", params=params,
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
        timeout=15,
    )
    if resp.status_code == 401:
        global TOKEN_CACHE, TOKEN_EXPIRES
        TOKEN_CACHE = None
        TOKEN_EXPIRES = 0
        return search_products(term=term, upc=upc, location_id=location_id, limit=limit)
    resp.raise_for_status()
    return resp.json().get("data", [])


def find_store(zip_code: str = "43147") -> Optional[dict]:
    """Find a Kroger store by zip code."""
    token = get_token()
    resp = req.get(
        "https://api.kroger.com/v1/locations",
        params={"filter.zipCode": zip_code, "filter.limit": 5, "filter.chain": "Kroger"},
        headers={"Authorization": f"Bearer {token}"}, timeout=15,
    )
    if resp.status_code == 200:
        locs = resp.json().get("data", [])
        if locs:
            return locs[0]
    return None


# ─── KrogerScraper Class ────────────────────────────────────────────────

class KrogerScraper(BaseScraper):
    """Kroger scraper — REST API for prices, Playwright for orders."""

    SITE_NAME = "kroger"
    LOGIN_URL = "https://www.kroger.com/signin"
    ORDERS_URL = "https://www.kroger.com/mypurchases"

    def __init__(self, headless: bool = False, record_video: bool = False):
        self.headless = headless
        self.record_video = record_video
        self._api_token = None
        self._pw = None
        self.browser = None
        self.context = None
        self.page = None
        self.authenticated = False

    # ─── Playwright lifecycle (for order scraping) ─────────────────────

    def launch_browser(self):
        """Launch headed Playwright browser for Kroger website login."""
        from playwright.sync_api import sync_playwright
        from core import get_launch_kwargs, get_context_kwargs, apply_stealth_js, screenshot_dir
        self._pw = sync_playwright().start()
        lk = get_launch_kwargs(self.SITE_NAME, headless=self.headless)
        lk.pop("user_data_dir", None)  # not valid for browser.launch()
        ck = get_context_kwargs(self.SITE_NAME)
        if self.record_video:
            ck["record_video_dir"] = str(screenshot_dir(self.SITE_NAME) / "videos")
        self.browser = self._pw.chromium.launch(**lk)
        self.context = self.browser.new_context(**ck)
        self.page = self.context.new_page()
        apply_stealth_js(self.page)
        self.page.on("dialog", lambda d: d.dismiss())
        logger.info("Kroger browser launched for order scraping")

    def close_browser(self):
        """Teardown Playwright browser."""
        if self.page:
            try:
                self.page.close()
            except Exception:
                pass
        if self.context:
            try:
                self.context.close()
            except Exception:
                pass
        if self.browser:
            try:
                self.browser.close()
            except Exception:
                pass
        if self._pw:
            try:
                self._pw.stop()
            except Exception:
                pass

    def launch(self):
        """No-op — we launch browser lazily only when scraping orders."""
        pass

    def close(self):
        """No-op — call close_browser() explicitly if needed."""
        pass

    def __enter__(self):
        self.launch()
        return self

    def __exit__(self, *args):
        self.close()

    def goto(self, url: str, wait_until: str = "networkidle", **kwargs):
        """Navigate and wait."""
        if not self.page:
            self.launch_browser()
        logger.info(f"Navigating to {url}")
        self.page.goto(url, wait_until=wait_until, **kwargs)
        human_delay(1.0, 3.0)

    def safe_click(self, selector: str, timeout: int = 15000, **kwargs):
        """Click with human-like delay."""
        if not self.page:
            raise RuntimeError("Browser not launched — call launch_browser() first")
        self.page.wait_for_selector(selector, timeout=timeout)
        time.sleep(0.5)
        self.page.click(selector, **kwargs)
        human_delay()

    def safe_fill(self, selector: str, text: str, simulate_typing: bool = True):
        """Fill input with human-like typing."""
        if not self.page:
            raise RuntimeError("Browser not launched")
        self.page.wait_for_selector(selector, timeout=15000)
        self.page.fill(selector, text)
        human_delay(0.2, 0.8)

    def screenshot(self, name: str = "debug"):
        """Take debugging screenshot."""
        if self.page:
            from core import screenshot_dir
            path = screenshot_dir(self.SITE_NAME) / f"{name}_{int(time.time())}.png"
            self.page.screenshot(path=str(path))
            logger.info(f"Screenshot: {path}")
            return path

    def save_state(self):
        """Save session for reuse."""
        if self.context:
            state_path = os.path.join(PROFILES_DIR, "kroger", "storage_state.json")
            os.makedirs(os.path.dirname(state_path), exist_ok=True)
            self.context.storage_state(path=state_path)
            self.authenticated = True
            logger.info("Session saved")

    # ─── API Auth (for prices) ─────────────────────────────────────────

    def _do_login(self, username: str = "", password: str = "") -> bool:
        """Get API token for price scraping."""
        try:
            self._api_token = get_token()
            logger.info("✅ Kroger API token obtained")
            return True
        except Exception as e:
            logger.error(f"Kroger API token failed: {e}")
            return False

    def is_authenticated(self) -> bool:
        return self._api_token is not None or self.authenticated

    # ─── Website Login (for orders) ────────────────────────────────────

    def website_login(self, username: str, password: str) -> bool:
        """Login to Kroger website using Playwright browser with persistent session."""
        logger.info(f"Logging into Kroger as {username}")

        if not self.page:
            from playwright.sync_api import sync_playwright
            from core import get_launch_kwargs, get_context_kwargs, apply_stealth_js

            # Try to load saved session
            storage_state_path = os.path.join(PROFILES_DIR, "kroger", "storage_state.json")
            saved_session = None
            if os.path.exists(storage_state_path):
                with open(storage_state_path) as f:
                    saved_session = json.load(f)
                logger.info(f"Loaded saved session ({len(saved_session.get('cookies', []))} cookies)")

            self._pw = sync_playwright().start()
            lk = get_launch_kwargs(self.SITE_NAME, headless=self.headless)
            lk.pop("user_data_dir", None)
            self.browser = self._pw.chromium.launch(**lk)
            ck = get_context_kwargs(self.SITE_NAME)
            ck["storage_state"] = saved_session
            self.context = self.browser.new_context(**ck)
            self.page = self.context.new_page()
            apply_stealth_js(self.page)

        # Homepage warm-up
        self.goto("https://www.kroger.com", wait_until="domcontentloaded")
        time.sleep(2)

        # Check if already logged in by looking for user name on page
        body = self.page.inner_text("body")
        # Kroger shows first name only (e.g. "EMILEE" from "emileesutliff")
        user_part = username.split("@")[0]
        first_name = user_part[:6].upper() if len(user_part) >= 6 else user_part.upper()
        if first_name in body or "Sign Out" in body or "My Account" in body:
            logger.info("✅ Already logged in")
            self.save_state()
            return True

        # Navigate to sign-in
        self.goto(self.LOGIN_URL, wait_until="domcontentloaded")
        time.sleep(3)

        if "signin" not in self.page.url.lower() and "login" not in self.page.url.lower():
            logger.info("✅ Already logged in (redirected)")
            self.save_state()
            return True

        # Fill login form (single page: email + password together)
        logger.info(f"Login page: {self.page.url[:80]}")

        try:
            self.safe_fill("#signInName", username)
            logger.info("✅ Email entered")
            time.sleep(0.5)
            self.safe_fill("#password", password)
            logger.info("✅ Password entered")
            time.sleep(0.5)
            self.safe_click("#continue")
            logger.info("✅ Clicked Sign In")
        except Exception as e:
            logger.warning(f"Login form fill failed: {e}")
            self.screenshot("kroger_login_form_fail")
            return False

        # Wait for redirect chain to complete (Azure AD B2C → callback → home)
        logger.info("Waiting for Azure AD B2C redirect...")
        start = time.time()
        timeout = 60
        redirect_complete = False
        while time.time() - start < timeout:
            time.sleep(2)
            cur = self.page.url
            if "www.kroger.com" in cur and "signin" not in cur.lower():
                redirect_complete = True
                logger.info(f"✅ Redirect complete: {cur[:60]}")
                break

        if not redirect_complete:
            logger.warning("Azure AD redirect timeout")
            self.screenshot("kroger_redirect_timeout")
            return False

        # Confirm logged-in state
        time.sleep(3)
        body = self.page.inner_text("body")
        user_part = username.split("@")[0]
        first_name = user_part[:6].upper()
        if "Sign Out" in body or first_name in body:
            logger.info("✅ Kroger login successful")
            self.save_state()
            return True
        else:
            logger.warning("Login state not confirmed after redirect")
            self.screenshot("kroger_login_state_fail")
            return False

    # ─── Order Scraping ────────────────────────────────────────────────

    def scrape_orders(self, max_orders: int = 50) -> list[dict]:
        """Scrape order history from Kroger website.

        Requires browser automation. Opens headed browser on desktop
        for MFA if needed.
        """
        logger.info("Scraping Kroger orders...")

        # Load user creds from Vault
        creds_file = os.path.join(PROFILES_DIR, "credentials.json")
        if not os.path.exists(creds_file):
            sys.path.insert(0, PROFILES_DIR)
            from export_creds import export
            export()
        with open(creds_file) as f:
            all_creds = json.load(f)
        user_creds = all_creds.get("kroger", {})
        username = user_creds.get("user", "")
        password = user_creds.get("pass", "")

        if not username:
            logger.error("No Kroger credentials in Vault")
            return []

        # Website login (now uses persistent context)
        if not self.authenticated:
            success = self.website_login(username, password)
            if not success:
                logger.error("Kroger website login failed")
                return []

        # Save session state for reuse
        self.save_state()

        # Try to find order data. Kroger uses React SPA.
        # URL is: https://www.kroger.com/mypurchases
        try:
            self.goto("https://www.kroger.com/mypurchases", wait_until="domcontentloaded")
            time.sleep(5)
            body = self.page.inner_text("body")
            if "Error" not in body[:100] and "bad link" not in body[:100]:
                logger.info("✅ Kroger mypurchases page found")
            else:
                logger.warning("mypurchases page has error — trying alternatives")
                raise Exception("Bad link")
        except Exception:
            possible_urls = [
                "https://www.kroger.com/purchases",
                "https://www.kroger.com/account",
                "https://www.kroger.com/my-account",
            ]
            for url in possible_urls:
                try:
                    self.goto(url, wait_until="domcontentloaded")
                    time.sleep(3)
                    body = self.page.inner_text("body")
                    if "Error" not in body[:100] and "bad link" not in body[:100]:
                        logger.info(f"✅ Found orders page: {url}")
                        break
                except Exception:
                    continue

        orders = []
        page_num = 0

        while len(orders) < max_orders and page_num < 10:
            page_num += 1
            logger.info(f"Orders page {page_num}...")

            # Kroger mypurchases uses citrus-Card elements in an accordion layout
            cards = self.page.query_selector_all("li.citrus-Card")
            if not cards:
                cards = self.page.query_selector_all("[class*='order-card'], [class*='OrderCard'], [data-testid*='order'], article")
            if not cards:
                # Try broader
                body_text = self.page.inner_text("body")
                logger.info(f"Page text preview: {body_text[:300]}")

            old_count = len(orders)
            for card in cards:
                if not card.is_visible():
                    continue
                try:
                    text = card.inner_text()
                    links = card.query_selector_all("a")
                    order_link = ""
                    for link in links:
                        href = link.get_attribute("href") or ""
                        if "/orders/" in href or "/purchase/" in href or "/receipt/" in href:
                            order_link = href
                            break

                    order_id = ""
                    if order_link:
                        m = re.search(r'/orders?/([^/?]+)', order_link)
                        if m:
                            order_id = m.group(1)

                    # Extract date
                    date_m = re.search(r'(\w+ \d{1,2},?\s?\d{4})', text)
                    # Extract total
                    total_m = re.search(r'\$(\d+\.?\d*)', text)

                    if order_id or date_m:
                        orders.append({
                            "store": "kroger",
                            "order_id": order_id or f"kroger_{date_m.group(0)}_{page_num}",
                            "order_date": date_m.group(0) if date_m else None,
                            "total": float(total_m.group(1)) if total_m else None,
                            "items": [],
                            "item_count": 0,
                            "raw_text": text[:500] if not order_id else None,
                        })
                except Exception:
                    continue

            logger.info(f"  Found {len(orders) - old_count} orders this page ({len(orders)} total)")

            # Next page
            try:
                nbs = self.page.query_selector_all(
                    "a[aria-label='Next'], button[aria-label='Next'], "
                    "a:has-text('Next'), button:has-text('Next'), "
                    "[class*='pagination'] a:has-text('Next')"
                )
                nb = None
                for n in nbs:
                    if n.is_visible():
                        nb = n
                        break
                if not nb:
                    break
                dis = nb.get_attribute("disabled") or ""
                if "true" in dis.lower() or nb.get_attribute("aria-disabled") == "true":
                    break
                nb.click()
                time.sleep(3)
            except Exception:
                break

        logger.info(f"✅ Kroger: {len(orders)} orders scraped")
        self.save_state()

        # Close browser if we launched it for order scraping
        self.close_browser()
        return orders

    # ─── Price Scraping (API-based, no browser) ────────────────────────

    def scrape_current_prices(self, zip_code: str = "43147") -> list[dict]:
        """Scrape prices via Kroger Public API."""
        if not self._api_token:
            if not self.login():
                return []

        logger.info(f"Scraping Kroger prices near {zip_code}...")
        store = find_store(zip_code)
        location_id = store["locationId"] if store else ""

        queries = [
            "milk gallon", "bread white", "eggs large dozen", "bananas",
            "butter salted", "cheese shredded", "chicken breast", "ground beef 80",
            "rice white", "pasta spaghetti", "tomato sauce", "potatoes russet",
            "onions yellow", "apples", "orange juice", "coffee ground",
            "sugar granulated", "flour all purpose", "cooking oil", "salt",
            "pepper black", "cereal", "peanut butter", "jelly strawberry",
            "yogurt greek", "cream cheese", "sour cream", "cottage cheese",
            "margarine", "bacon", "sausage", "hot dogs",
            "frozen pizza", "ice cream vanilla", "frozen vegetables",
            "canned tomatoes", "canned beans", "chicken broth",
            "ketchup", "mustard yellow", "mayonnaise", "pickles",
            "soda coke", "water bottled", "paper towels", "toilet paper",
            "dish soap", "laundry detergent", "trash bags",
        ]

        results = []
        for query in queries:
            try:
                products = search_products(term=query, location_id=location_id, limit=3)
                for p in products:
                    items = p.get("items", [])
                    for item in items[:1]:
                        price = item.get("price", {})
                        regular = price.get("regular")
                        if not regular:
                            continue
                        results.append({
                            "store": "kroger",
                            "name": p.get("description", query),
                            "brand": p.get("brand", ""),
                            "sku": item.get("itemId", p.get("upc", "")),
                            "upc": p.get("upc", ""),
                            "price": float(regular),
                            "size": item.get("size", ""),
                            "category": p.get("categories", [None])[0] if p.get("categories") else "Unknown",
                            "in_stock": item.get("inventory", {}).get("stockLevel", "HIGH") != "OUT_OF_STOCK",
                        })
                logger.debug(f"  {query}: {len(products)} products")
            except Exception as e:
                logger.warning(f"Search failed '{query}': {e}")
            time.sleep(0.15)

        logger.info(f"✅ Kroger: {len(results)} prices scraped")
        return results


# ─── CLI ────────────────────────────────────────────────────────────────

def main():
    import argparse
    parser = argparse.ArgumentParser(description="Kroger scraper")
    parser.add_argument("--term", help="Search products by term")
    parser.add_argument("--upc", help="Search by UPC")
    parser.add_argument("--scrape-prices", action="store_true", help="Scrape prices via API")
    parser.add_argument("--scrape-orders", action="store_true", help="Scrape orders via browser")
    parser.add_argument("--store-zip", default="43147")
    parser.add_argument("--limit", type=int, default=10)
    args = parser.parse_args()

    if args.scrape_orders:
        scraper = KrogerScraper(headless=False)
        orders = scraper.scrape_orders(max_orders=args.limit)
        print(json.dumps(orders, indent=2))
        print(f"\n✅ {len(orders)} orders scraped")
    elif args.scrape_prices:
        scraper = KrogerScraper()
        if scraper.login():
            items = scraper.scrape_current_prices(args.store_zip)
            print(json.dumps(items, indent=2))
            print(f"\n✅ {len(items)} prices scraped")
    elif args.term or args.upc:
        results = search_products(term=args.term or "", upc=args.upc or "", limit=args.limit)
        print(json.dumps(results, indent=2))
    else:
        for t in ["milk gallon", "bread white", "eggs large dozen", "bananas"]:
            for p in search_products(term=t, limit=2):
                price = p.get("items", [{}])[0].get("price", {}).get("regular", "N/A")
                print(f"  {p['description']:45s} ${price}")


if __name__ == "__main__":
    main()
