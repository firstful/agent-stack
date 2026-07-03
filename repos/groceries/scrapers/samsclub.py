"""
Sam's Club scraper — uses same Walmart infrastructure (same parent company).
"""
import re
import json
import time
import random
import logging

from scrapers.base import BaseScraper

logger = logging.getLogger(__name__)


class SamsClubScraper(BaseScraper):
    SITE_NAME = "samsclub"
    LOGIN_URL = "https://www.samsclub.com/account/login"
    ORDERS_URL = "https://www.samsclub.com/orders"

    def _do_login(self, username: str, password: str) -> bool:
        """Login to Sam's Club."""
        logger.info("Logging into Sam's Club...")
        self.goto(self.LOGIN_URL, wait_until="networkidle")

        try:
            # Sam's login: email or username
            self.safe_fill("input[id='email'], input[type='email'], input[name='email']", username)
            self.safe_click("button[type='submit'], button:has-text('Continue')")
            time.sleep(random.uniform(2, 3))

            # Password
            self.safe_fill("input[id='password'], input[type='password']", password)
            self.safe_click("button[type='submit']:has-text('Sign In'), button:has-text('Sign in')")
        except Exception as e:
            logger.warning(f"Sam's standard login failed: {e}")
            self.screenshot("sams_login_fallback")

        return self.wait_for_login_complete(wait_seconds=120)

    def _check_logged_in(self) -> bool:
        try:
            self.page.wait_for_timeout(2000)
            if "Sign Out" in self.page.content() or "My Account" in self.page.content():
                return True
        except Exception:
            pass
        return False

    def scrape_orders(self, max_orders: int = 50) -> list[dict]:
        """Scrape Sam's Club order history."""
        if not self.authenticated:
            raise RuntimeError("Not authenticated.")

        logger.info("Scraping Sam's Club orders...")
        self.goto(self.ORDERS_URL, wait_until="networkidle")
        time.sleep(3)

        orders = []
        page_num = 0

        while len(orders) < max_orders:
            page_num += 1
            logger.info(f"Scraping Sam's page {page_num}...")

            try:
                self.page.wait_for_selector(
                    "[class*='order'], [data-testid*='order'], [class*='purchase-history']",
                    timeout=10000
                )
            except Exception:
                break

            # Parse orders from current page
            order_els = self.page.query_selector_all(
                "[class*='order-card'], [class*='orderRow'], [class*='order-detail']"
            )
            for el in order_els:
                try:
                    order = self._parse_order(el)
                    if order:
                        orders.append(order)
                except Exception as e:
                    logger.debug(f"Parse error: {e}")

            if len(orders) >= max_orders or not self._go_next():
                break

        logger.info(f"Sam's Club orders scraped: {len(orders)}")
        return orders[:max_orders]

    def _parse_order(self, el) -> dict:
        """Parse a Sam's Club order element."""
        text = el.inner_text()
        order_id = ""
        m = re.search(r'Order\s*(?:#|ID)?\s*:?\s*(\d+)', text, re.IGNORECASE)
        if m:
            order_id = m.group(1)

        date_str = ""
        m = re.search(r'(?:Order\s+)?(?:Date|Placed)\s*:?\s*(.+?)(?:\n|$)', text, re.IGNORECASE)
        if m:
            date_str = m.group(1).strip()

        total = None
        m = re.search(r'(?:Total|Amount)\s*:?\s*\$?(\d+\.?\d*)', text, re.IGNORECASE)
        if m:
            total = float(m.group(1))

        return {
            "store": "samsclub",
            "order_id": order_id,
            "order_date": date_str,
            "total": total,
            "items": [],
        }

    def _go_next(self) -> bool:
        try:
            nxt = self.page.query_selector(
                "a[aria-label='Next'], button[aria-label='Next'], a:has-text('Next')"
            )
            if nxt:
                nxt.click()
                time.sleep(random.uniform(2, 4))
                return True
        except Exception:
            pass
        return False

    def scrape_current_prices(self, zip_code: str = "43147") -> list[dict]:
        """Scrape Sam's Club prices — uses their category pages."""
        items = []
        self.goto("https://www.samsclub.com/grocery", wait_until="networkidle")
        time.sleep(3)

        try:
            cards = self.page.query_selector_all("[class*='product-card'], [class*='tile']")
            for card in cards:
                try:
                    name_el = card.query_selector("[class*='name'], [class*='title']")
                    price_el = card.query_selector("[class*='price'], [class*='cost']")
                    name = name_el.inner_text().strip() if name_el else ""
                    price = None
                    if price_el:
                        m = re.search(r'\$?(\d+\.?\d*)', price_el.inner_text())
                        if m:
                            price = float(m.group(1))
                    if name:
                        items.append({
                            "store": "samsclub",
                            "name": name,
                            "price": price,
                            "scraped_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
                        })
                except Exception:
                    continue
        except Exception as e:
            logger.warning(f"Sam's price scrape failed: {e}")

        return items
