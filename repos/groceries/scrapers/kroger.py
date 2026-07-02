"""
Kroger scraper — order history and local prices.
Kroger has strong bot protection (DataDome). Headed mode + real profiles are essential.
"""
import re
import json
import time
import random
import logging
from typing import Optional

from scrapers.base import BaseScraper

logger = logging.getLogger(__name__)


class KrogerScraper(BaseScraper):
    SITE_NAME = "kroger"
    LOGIN_URL = "https://www.kroger.com/signin"
    ORDERS_URL = "https://www.kroger.com/ordertracker/order-history"

    def login(self, username: str, password: str) -> bool:
        """Login to Kroger."""
        logger.info("Logging into Kroger...")
        self.goto(self.LOGIN_URL, wait_until="networkidle")
        time.sleep(random.uniform(2, 4))

        try:
            # Kroger uses a modal/overlay sign-in
            # Email
            email_sels = ["input[name='email']", "input[type='email']", "input[data-qa='email']"]
            for sel in email_sels:
                if self.page.query_selector(sel):
                    self.safe_fill(sel, username)
                    break

            # Continue / Next
            btn = self.page.query_selector(
                "button:has-text('Continue'), button:has-text('Next'), button[type='submit']"
            )
            if btn:
                btn.click()
                time.sleep(random.uniform(2, 4))

            # Password
            pw_sels = ["input[name='password']", "input[type='password']", "input[data-qa='password']"]
            for sel in pw_sels:
                if self.page.query_selector(sel):
                    self.safe_fill(sel, password)
                    break

            # Sign in
            signin_btn = self.page.query_selector(
                "button:has-text('Sign In'), button:has-text('Sign in'), button[data-qa='sign-in']"
            )
            if signin_btn:
                signin_btn.click()
            else:
                # Submit form
                self.page.keyboard.press("Enter")

        except Exception as e:
            logger.warning(f"Kroger standard login failed: {e}")
            self.screenshot("kroger_login_fallback")

        return self.wait_for_login_complete(wait_seconds=120)

    def _check_logged_in(self) -> bool:
        try:
            self.page.wait_for_timeout(3000)
            body = self.page.inner_text("body")
            if "My Account" in body or "Sign Out" in body or "Order History" in body:
                return True
            current_url = self.page.url
            if "signin" not in current_url.lower() and "login" not in current_url.lower():
                return True
        except Exception:
            pass
        return False

    def scrape_orders(self, max_orders: int = 50) -> list[dict]:
        """Scrape Kroger order history."""
        if not self.authenticated:
            raise RuntimeError("Not authenticated.")

        logger.info("Scraping Kroger orders...")
        self.goto(self.ORDERS_URL, wait_until="networkidle")
        time.sleep(4)

        orders = []
        page_num = 0

        while len(orders) < max_orders:
            page_num += 1
            logger.info(f"Kroger orders page {page_num}...")

            try:
                self.page.wait_for_selector(
                    "[class*='order'], [class*='receipt'], [data-testid*='order'], "
                    "[class*='OrderHistory']",
                    timeout=15000
                )
            except Exception:
                break

            # Parse order cards
            order_els = self.page.query_selector_all(
                "[class*='order-card'], [class*='OrderCard'], [class*='receipt']"
            )
            for el in order_els:
                try:
                    order = self._parse_order(el)
                    if order and order.get("order_id"):
                        orders.append(order)
                except Exception as e:
                    logger.debug(f"Kroger parse error: {e}")

            if len(orders) >= max_orders or not self._go_next():
                break

        logger.info(f"Kroger orders scraped: {len(orders)}")
        return orders[:max_orders]

    def _parse_order(self, el) -> Optional[dict]:
        """Parse a Kroger order element."""
        try:
            text = el.inner_text()
            html = el.inner_html()

            order_id = ""
            m = re.search(r'(?:Order|Order\s*#)\s*:?\s*(\d{4,})', text)
            if m:
                order_id = m.group(1)
            if not order_id:
                m = re.search(r'order[=_/](\d+)', html, re.IGNORECASE)
                if m:
                    order_id = m.group(1)

            date_str = ""
            m = re.search(r'(?:Ordered|Placed|Date)\s*(?::|on)?\s*([A-Za-z]+\s+\d{1,2},?\s*\d{4})', text)
            if m:
                date_str = m.group(1)
            if not date_str:
                m = re.search(r'(\d{2}/\d{2}/\d{4})', text)
                if m:
                    date_str = m.group(1)

            total = None
            m = re.search(r'(?:Total|Amount)\s*:?\s*\$?(\d+\.?\d*)', text)
            if m:
                total = float(m.group(1))

            # Items
            items = []
            item_els = el.query_selector_all("[class*='item'], [class*='product'], li")
            for item_el in item_els:
                name = item_el.inner_text().strip()
                if name and len(name) > 2:
                    items.append({"name": name, "quantity": 1, "price": None})

            return {
                "store": "kroger",
                "order_id": order_id,
                "order_date": date_str,
                "total": total,
                "items": items,
                "item_count": len(items),
            }

        except Exception as e:
            logger.debug(f"Kroger order parse error: {e}")
        return None

    def _go_next(self) -> bool:
        try:
            nxt = self.page.query_selector(
                "a[aria-label='Next'], button[aria-label='Next'], a[class*='next']"
            )
            if nxt:
                nxt.click()
                time.sleep(random.uniform(2, 4))
                return True
        except Exception:
            pass
        return False

    def scrape_current_prices(self, zip_code: str = "43147") -> list[dict]:
        """Scrape Kroger prices — uses their 'shop' section."""
        items = []

        # Kroger's shop URL — set zip/store first
        from urllib.parse import quote
        self.goto(f"https://www.kroger.com/?zipcode={zip_code}", wait_until="networkidle")
        time.sleep(3)

        # Set store
        try:
            self.safe_click("button:has-text('Start Shopping')", timeout=5000)
        except Exception:
            pass
        time.sleep(3)

        # Browse departments
        departments = ["milk-eggs", "bread-bakery", "meat-seafood", "fruits-vegetables"]
        for dept in departments:
            try:
                dept_url = f"https://www.kroger.com/pl/{dept}"
                self.goto(dept_url, wait_until="networkidle")
                time.sleep(random.uniform(2, 4))

                cards = self.page.query_selector_all("[class*='product'], [data-qa='product']")
                for card in cards[:10]:
                    try:
                        name_el = card.query_selector("[class*='name'], [class*='title'], [data-qa='product-name']")
                        name = name_el.inner_text().strip() if name_el else ""

                        price_el = card.query_selector("[class*='price'], [data-qa='price']")
                        price_text = price_el.inner_text() if price_el else ""
                        price = None
                        m = re.search(r'\$?(\d+\.?\d*)', price_text)
                        if m:
                            price = float(m.group(1))

                        if name:
                            items.append({
                                "store": "kroger",
                                "name": name,
                                "price": price,
                                "scraped_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
                            })
                    except Exception:
                        continue
            except Exception:
                continue

        return items
