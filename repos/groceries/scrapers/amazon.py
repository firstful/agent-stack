"""
Amazon scraper — order history and prices.

Amazon has the most aggressive bot detection. Key strategies:
- Uses real desktop display (headed), not headless
- Pre-warms the session with a homepage visit before login
- Handles OTP/2FA via the real display
- Mimics human browsing patterns
"""
import re
import json
import time
import random
import logging
from typing import Optional

from scrapers.base import BaseScraper

logger = logging.getLogger(__name__)


class AmazonScraper(BaseScraper):
    SITE_NAME = "amazon"
    LOGIN_URL = "https://www.amazon.com/ap/signin"
    ORDERS_URL = "https://www.amazon.com/your-orders"

    def login(self, username: str, password: str) -> bool:
        """Login to Amazon with human-like delays."""
        logger.info("Logging into Amazon...")

        # Pre-warm: visit homepage first like a real user
        self.goto("https://www.amazon.com", wait_until="networkidle")
        human_delay(2, 4)
        random_scroll(self.page, 2)

        # Now go to sign-in
        self.goto(self.LOGIN_URL, wait_until="networkidle")
        time.sleep(random.uniform(2, 4))

        try:
            # Amazon sign-in: email first
            email_selectors = [
                "input[name='email']",
                "input[type='email']",
                "input[id='ap_email']",
            ]
            for sel in email_selectors:
                if self.page.query_selector(sel):
                    self.safe_fill(sel, username)
                    break

            self.safe_click("input[id='continue'], button[id='continue'], input[type='submit']")
            time.sleep(random.uniform(2, 5))

            # Password
            pw_selectors = [
                "input[name='password']",
                "input[type='password']",
                "input[id='ap_password']",
            ]
            for sel in pw_selectors:
                if self.page.query_selector(sel):
                    self.safe_fill(sel, password)
                    break

            self.safe_click("input[id='signInSubmit'], button[id='signInSubmit']")
            time.sleep(random.uniform(3, 5))

        except Exception as e:
            logger.warning(f"Amazon standard login failed: {e}")
            self.screenshot("amazon_login_fallback")

        # Amazon often asks for OTP — wait longer for manual entry
        return self.wait_for_login_complete(wait_seconds=180)

    def _check_logged_in(self) -> bool:
        """Amazon-specific logged-in check."""
        try:
            self.page.wait_for_timeout(3000)
            body_text = self.page.inner_text("body")

            # OTP/2FA challenge
            if "Enter OTP" in body_text or "verification code" in body_text.lower():
                logger.info("Amazon OTP challenge detected — waiting for manual entry")
                return False

            # Logged-in indicators
            if "Hello, " in body_text or "Your Account" in body_text or "Your Orders" in body_text:
                return True

            # URL-based check (redirected to home)
            if "amazon.com" in self.page.url and "ap/signin" not in self.page.url:
                return True

        except Exception:
            pass
        return False

    def scrape_orders(self, max_orders: int = 50) -> list[dict]:
        """Scrape Amazon order history — year by year, page by page."""
        if not self.authenticated:
            raise RuntimeError("Not authenticated.")

        orders = []

        # Amazon groups orders by year: /your-orders?orderFilter=year-2025
        current_year = 2026
        years_to_check = list(range(2020, current_year + 1))

        for year in reversed(years_to_check):
            if len(orders) >= max_orders:
                break

            logger.info(f"Scraping Amazon orders for {year}...")
            url = f"https://www.amazon.com/your-orders?orderFilter=year-{year}"
            self.goto(url, wait_until="networkidle")
            time.sleep(random.uniform(3, 5))

            page_num = 0
            while len(orders) < max_orders:
                page_num += 1
                logger.info(f"Amazon {year}, page {page_num}...")

                try:
                    self.page.wait_for_selector(
                        "[class*='order'], [data-testid*='order'], .a-box-group",
                        timeout=15000
                    )
                except Exception:
                    logger.info(f"No more orders for {year}")
                    break

                # Parse visible orders
                order_elements = self.page.query_selector_all(
                    ".order-card, [class*='order-card'], .a-box-group, "
                    "[class*='your-order']"
                )
                for el in order_elements:
                    try:
                        order = self._parse_order(el)
                        if order and order.get("order_id"):
                            orders.append(order)
                    except Exception as e:
                        logger.debug(f"Amazon order parse error: {e}")

                # Next page
                if not self._go_next_page():
                    break

                time.sleep(random.uniform(2, 4))

        logger.info(f"Total Amazon orders scraped: {len(orders)}")
        return orders[:max_orders]

    def _parse_order(self, el) -> Optional[dict]:
        """Parse a single Amazon order block."""
        try:
            html = el.inner_html()
            text = el.inner_text()
            if not text.strip():
                return None

            # Order ID
            order_id = ""
            m = re.search(r'Order\s*#\s*(\d{3}-\d{7}-\d{7})', text)
            if m:
                order_id = m.group(1)

            # Order date
            date_str = ""
            m = re.search(r'(?:Ordered|Placed)\s*(?::|on)?\s*([A-Za-z]+\s+\d{1,2},?\s*\d{4})', text)
            if m:
                date_str = m.group(1)
            m = re.search(r'(\d{1,2}/\d{1,2}/\d{4})', text)
            if not date_str and m:
                date_str = m.group(1)

            # Total
            total = None
            m = re.search(r'Total\s*[:\$]*\s*\$?(\d+\.?\d*)', text)
            if m:
                total = float(m.group(1))

            # Items
            items = []
            # Amazon has item rows within each order
            item_rows = el.query_selector_all(
                ".a-row .a-link-normal, [class*='item'], .yo-item"
            )
            for item_el in item_rows:
                item_text = item_el.inner_text().strip()
                if item_text and len(item_text) > 3:
                    items.append({
                        "name": item_text,
                        "quantity": 1,
                        "price": None,
                    })

            return {
                "store": "amazon",
                "order_id": order_id,
                "order_date": date_str,
                "total": total,
                "items": items,
                "item_count": len(items),
            }

        except Exception as e:
            logger.debug(f"Amazon order parse error: {e}")
        return None

    def _go_next_page(self) -> bool:
        """Go to the next page of orders for a given year."""
        try:
            next_btn = self.page.query_selector(
                "a[aria-label='Next Page'], li.a-last a, .a-pagination .a-last a"
            )
            if next_btn:
                is_disabled = next_btn.get_attribute("aria-disabled")
                if is_disabled == "true":
                    return False
                next_btn.click()
                time.sleep(random.uniform(2, 4))
                self.page.wait_for_load_state("networkidle")
                return True
        except Exception:
            pass
        return False

    def scrape_current_prices(self, zip_code: str = "43147") -> list[dict]:
        """
        Scrape Amazon prices for common grocery / household items.
        Uses search queries for items we commonly buy.
        """
        items = []

        # Common grocery categories to search
        searches = [
            "milk whole gallon", "bread white", "eggs large dozen",
            "butter unsalted", "chicken breast", "ground beef 80/20",
            "bananas", "apples", "orange juice",
            "coffee ground", "paper towels", "toilet paper",
            "dish soap", "laundry detergent", "trash bags",
        ]

        for query in searches[:5]:  # First 5 only to keep it fast
            try:
                search_url = f"https://www.amazon.com/s?k={query.replace(' ', '+')}"
                self.goto(search_url, wait_until="networkidle")
                time.sleep(random.uniform(2, 4))

                cards = self.page.query_selector_all(
                    "[data-component-type='s-search-result'], .s-result-item"
                )
                for card in cards[:5]:
                    try:
                        name_el = card.query_selector("h2 a, h2 span, [class*='title']")
                        name = name_el.inner_text().strip() if name_el else ""

                        price_text = card.inner_text()
                        m = re.search(r'\$(\d+\.?\d*)', price_text)
                        price = float(m.group(1)) if m else None

                        sku = card.get_attribute("data-asin") or ""

                        if name and price:
                            items.append({
                                "store": "amazon",
                                "name": name,
                                "price": price,
                                "sku": sku,
                                "scraped_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
                            })
                    except Exception:
                        continue
            except Exception:
                continue

        return items

    @staticmethod
    def human_delay(min_s=0.5, max_s=2.0):
        time.sleep(random.uniform(min_s, max_s))
