"""
Walmart scraper — order history, prices, store locations.
"""
import re
import json
import time
import random
import logging
from typing import Optional

from scrapers.base import BaseScraper

logger = logging.getLogger(__name__)


class WalmartScraper(BaseScraper):
    SITE_NAME = "walmart"
    LOGIN_URL = "https://www.walmart.com/account/login"
    ORDERS_URL = "https://www.walmart.com/orders"

    def login(self, username: str, password: str) -> bool:
        """Login to Walmart."""
        logger.info("Logging into Walmart...")
        self.goto(self.LOGIN_URL, wait_until="networkidle")

        # Walmart login flow: email -> continue -> password -> sign in
        try:
            # Email/phone field
            self.safe_fill("input[id='email']", username)
            self.safe_click("button[type='submit']:has-text('Continue'), button:has-text('Sign in')")
            time.sleep(random.uniform(2, 4))

            # Password field
            pw_selector = "input[id='password'], input[type='password']"
            self.page.wait_for_selector(pw_selector, timeout=10000)
            self.safe_fill(pw_selector, password)
            self.safe_click("button[type='submit']:has-text('Sign in')")

        except Exception as e:
            logger.warning(f"Walmart standard login failed: {e}")
            # Fallback: let user handle via the real display
            self.screenshot("walmart_login_fallback")
            logger.info("Falling back to manual login...")

        return self.wait_for_login_complete(wait_seconds=120)

    def _check_logged_in(self) -> bool:
        """Check for Walmart logged-in state."""
        try:
            # After login, Walmart redirects to home with account greeting
            self.page.wait_for_timeout(2000)
            body = self.page.content()
            if "My Account" in body or "Sign Out" in body or "/orders" in self.page.url:
                return True
        except Exception:
            pass
        return False

    def scrape_orders(self, max_orders: int = 50) -> list[dict]:
        """Scrape past orders from Walmart."""
        if not self.authenticated:
            raise RuntimeError("Not authenticated. Call login() first.")

        logger.info(f"Scraping up to {max_orders} Walmart orders...")
        self.goto(self.ORDERS_URL, wait_until="networkidle")
        time.sleep(3)

        orders = []
        page_num = 0

        while len(orders) < max_orders:
            page_num += 1
            logger.info(f"Scraping Walmart orders page {page_num}...")

            # Wait for order cards to load
            try:
                self.page.wait_for_selector(
                    "[data-testid='order-card'], .order-card, div[class*='order']",
                    timeout=10000
                )
            except Exception:
                logger.info("No more order cards found")
                break

            # Parse order cards
            order_cards = self._parse_current_page_orders()
            orders.extend(order_cards)
            logger.info(f"Found {len(order_cards)} orders on page {page_num}")

            if len(orders) >= max_orders:
                break

            # Try to go to next page
            if not self._go_to_next_page():
                break

            time.sleep(random.uniform(2, 4))

        logger.info(f"Total Walmart orders scraped: {len(orders)}")
        return orders[:max_orders]

    def _parse_current_page_orders(self) -> list[dict]:
        """Parse order cards visible on the current page."""
        orders = []

        try:
            cards = self.page.query_selector_all(
                "[data-testid='order-card'], .order-card, div[class*='order']"
            )
            for card in cards:
                try:
                    order = self._parse_order_card(card)
                    if order:
                        orders.append(order)
                except Exception as e:
                    logger.warning(f"Failed to parse order card: {e}")
        except Exception as e:
            logger.warning(f"Failed to find order cards: {e}")

        return orders

    def _parse_order_card(self, card) -> Optional[dict]:
        """Parse a single Walmart order card element."""
        from playwright.sync_api import ElementHandle

        try:
            order_id_el = card.query_selector(
                "[data-testid='order-number'], [class*='order-number'], [class*='orderId']"
            )
            order_id = order_id_el.inner_text().strip() if order_id_el else ""

            date_el = card.query_selector(
                "[data-testid='order-date'], [class*='order-date'], time"
            )
            order_date = date_el.get_attribute("datetime") or date_el.inner_text().strip() if date_el else ""

            total_el = card.query_selector(
                "[class*='total'], [data-testid='total'], [class*='price']"
            )
            total_text = total_el.inner_text().strip() if total_el else ""
            total = self._extract_price(total_text)

            # Items
            items = []
            item_els = card.query_selector_all(
                "[data-testid='item'], .order-item, [class*='item']"
            )
            for item_el in item_els:
                name_el = item_el.query_selector(
                    "[class*='name'], [class*='title'], a"
                )
                name = name_el.inner_text().strip() if name_el else ""
                qty_el = item_el.query_selector("[class*='qty'], [class*='quantity']")
                qty_text = qty_el.inner_text() if qty_el else "1"
                qty = int(re.search(r'\d+', qty_text).group()) if re.search(r'\d+', qty_text) else 1
                price_el = item_el.query_selector("[class*='price']")
                price_text = price_el.inner_text() if price_el else ""
                price = self._extract_price(price_text)
                items.append({"name": name, "quantity": qty, "price": price})

            if not order_id:
                return None

            return {
                "store": "walmart",
                "order_id": order_id,
                "order_date": order_date,
                "total": total,
                "items": items,
                "item_count": len(items),
            }

        except Exception as e:
            logger.debug(f"Error parsing order card: {e}")
            return None

    def _go_to_next_page(self) -> bool:
        """Click the 'next page' button if available."""
        try:
            next_btn = self.page.query_selector(
                "a[aria-label='Next Page'], button[aria-label='Next'], a:has-text('Next'), "
                "button:has-text('Next'), [class*='pagination'] a:last-child"
            )
            if next_btn:
                is_disabled = next_btn.get_attribute("disabled") or next_btn.get_attribute("aria-disabled")
                if is_disabled and is_disabled.lower() == "true":
                    return False
                next_btn.click()
                time.sleep(random.uniform(2, 4))
                self.page.wait_for_load_state("networkidle")
                return True
        except Exception:
            pass
        return False

    @staticmethod
    def _extract_price(text: str) -> Optional[float]:
        """Extract a price number from text like '$12.34' or '12.34'."""
        if not text:
            return None
        m = re.search(r'[\$\€\£]?\s*(\d+\.?\d*)', text.replace(',', ''))
        if m:
            try:
                return float(m.group(1))
            except ValueError:
                pass
        return None

    def scrape_current_prices(self, zip_code: str = "43147") -> list[dict]:
        """
        Scrape current Walmart grocery prices for local store.
        Uses Walmart's grocery API endpoint directly for reliability.
        """
        logger.info(f"Scraping Walmart prices near {zip_code}...")
        items = []

        # First find the nearest store
        store_id = self._find_nearest_store(zip_code)
        if not store_id:
            logger.warning(f"No Walmart store found near {zip_code}")
            return items

        # Browse grocery categories and extract prices
        grocery_url = f"https://www.walmart.com/grocery/browse?storeId={store_id}"
        self.goto(grocery_url, wait_until="networkidle")
        time.sleep(3)

        # Scrape initial items
        items.extend(self._extract_grocery_items())

        # Browse a few popular departments
        depts = [
            "bakery", "dairy-eggs", "meat-seafood", "fruits-vegetables",
            "beverages", "snacks", "frozen", "pantry-staples"
        ]
        for dept in depts[:3]:  # First 3 to keep it reasonable
            dept_url = f"{grocery_url}&cat={dept}"
            self.goto(dept_url, wait_until="networkidle")
            items.extend(self._extract_grocery_items())
            if len(items) > 200:
                break

        return items

    def _find_nearest_store(self, zip_code: str) -> Optional[str]:
        """Find the nearest Walmart store ID for a zip code."""
        try:
            self.goto("https://www.walmart.com/store/finder", wait_until="networkidle")
            self.safe_fill("input[placeholder*='ZIP'], input[placeholder*='zip'], input[name='zip']", zip_code)
            self.safe_click("button[type='submit'], button:has-text('Search')")
            time.sleep(3)

            # Get first store result's ID
            store_el = self.page.query_selector("[data-storeid], a[href*='store/']")
            if store_el:
                store_id = store_el.get_attribute("data-storeid")
                if not store_id:
                    href = store_el.get_attribute("href") or ""
                    m = re.search(r'/store/(\d+)', href)
                    store_id = m.group(1) if m else None
                return store_id
        except Exception as e:
            logger.warning(f"Store finder failed: {e}")
        return None

    def _extract_grocery_items(self) -> list[dict]:
        """Extract grocery item names and prices from the current page."""
        items = []
        try:
            item_cards = self.page.query_selector_all(
                "[data-testid='item'], div[class*='item-card'], div[class*='gridItem']"
            )
            for card in item_cards:
                try:
                    name_el = card.query_selector("[class*='name'], [class*='title']")
                    name = name_el.inner_text().strip() if name_el else ""

                    price_el = card.query_selector("[class*='price'], [class*='Price-group']")
                    price_text = price_el.inner_text().strip() if price_el else ""
                    price = self._extract_price(price_text)

                    size_el = card.query_selector("[class*='size'], [class*='unit']")
                    size = size_el.inner_text().strip() if size_el else ""

                    sku_el = card.query_selector("[data-item-id], [data-sku]")
                    sku = (sku_el.get_attribute("data-item-id") or sku_el.get_attribute("data-sku")) if sku_el else ""

                    if name:
                        items.append({
                            "store": "walmart",
                            "name": name,
                            "price": price,
                            "size": size,
                            "sku": sku,
                            "scraped_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
                        })
                except Exception:
                    continue
        except Exception as e:
            logger.warning(f"Item extraction failed: {e}")
        return items


# For backwards compatibility / alias
Walmart = WalmartScraper
