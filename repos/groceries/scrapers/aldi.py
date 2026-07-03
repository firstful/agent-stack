"""
ALDI scraper — order history (Aldi doesn't have online ordering in most US locations).
Focuses on in-store price scraping from their weekly ads and product catalog.
"""
import re
import json
import time
import random
import logging
from typing import Optional

from scrapers.base import BaseScraper

logger = logging.getLogger(__name__)


class AldiScraper(BaseScraper):
    SITE_NAME = "aldi"
    LOGIN_URL = "https://www.aldi.us/en/account/login/"
    ORDERS_URL = "https://www.aldi.us/en/account/order-history/"

    def _do_login(self, username: str, password: str) -> bool:
        """
        Aldi may or may not have a traditional online ordering system.
        Their US site primarily serves as an informational site.
        """
        logger.info("Aldi login attempted (may not have online ordering)...")
        self.goto(self.LOGIN_URL, wait_until="networkidle")
        time.sleep(2)

        try:
            # Aldi's login form
            self.safe_fill("input[name='email'], input[type='email'], input[id*='email']", username)
            self.safe_fill("input[name='password'], input[type='password']", password)
            self.safe_click("button[type='submit'], button:has-text('Sign In'), button:has-text('Login')")
        except Exception as e:
            logger.warning(f"Aldi login flow failed: {e}")
            self.screenshot("aldi_login")

        return self.wait_for_login_complete(wait_seconds=60)

    def _check_logged_in(self) -> bool:
        try:
            self.page.wait_for_timeout(2000)
            if "My Account" in self.page.content():
                return True
        except Exception:
            pass
        return False

    def scrape_orders(self, max_orders: int = 50) -> list[dict]:
        """
        ALDI US generally doesn't have online ordering in most markets.
        Returns empty, but we can scrape their weekly ad for prices.
        """
        logger.info("ALDI US does not typically offer online ordering with accounts.")
        logger.info("Falling back to weekly ad / price scrape instead.")
        return []

    def scrape_current_prices(self, zip_code: str = "43147") -> list[dict]:
        """
        Scrape ALDI prices from their weekly ad and product catalog.
        This is the most valuable data from Aldi since they don't have
        traditional online ordering.
        """
        items = []
        logger.info(f"Scraping ALDI prices near {zip_code}...")

        # ALDI has a 'products' section that shows prices
        try:
            self.goto("https://www.aldi.us/en/products/", wait_until="networkidle")
            time.sleep(3)

            # Browse product categories
            categories = [
                "dairy-and-eggs", "meat-and-seafood", "fruits-and-vegetables",
                "bakery", "beverages", "snacks",
            ]

            for cat in categories:
                try:
                    cat_url = f"https://www.aldi.us/en/products/categories/{cat}/"
                    self.goto(cat_url, wait_until="networkidle")
                    time.sleep(random.uniform(2, 4))

                    products = self.page.query_selector_all(
                        "[class*='product'], [class*='tile'], [class*='item']"
                    )
                    for prod in products:
                        try:
                            name_el = prod.query_selector("[class*='name'], [class*='title'], h2, h3")
                            name = name_el.inner_text().strip() if name_el else ""

                            price_el = prod.query_selector("[class*='price'], [class*='cost']")
                            price_text = price_el.inner_text().strip() if price_el else ""
                            price = None
                            m = re.search(r'\$?(\d+\.?\d*)', price_text)
                            if m:
                                price = float(m.group(1))

                            if name:
                                items.append({
                                    "store": "aldi",
                                    "name": name,
                                    "price": price,
                                    "scraped_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
                                })
                        except Exception:
                            continue

                except Exception as e:
                    logger.debug(f"Aldi category {cat} failed: {e}")
                    continue

        except Exception as e:
            logger.warning(f"Aldi product page scrape failed: {e}")

        # Also try the weekly ad
        try:
            self.goto("https://www.aldi.us/en/weekly-specials/", wait_until="networkidle")
            time.sleep(3)
            ad_items = self.page.query_selector_all(
                "[class*='special'], [class*='offer'], [class*='product']"
            )
            for item in ad_items:
                try:
                    name_el = item.query_selector("[class*='name'], [class*='title'], h2, h3")
                    name = name_el.inner_text().strip() if name_el else ""

                    price_el = item.query_selector("[class*='price']")
                    price_text = price_el.inner_text().strip() if price_el else ""
                    price = None
                    m = re.search(r'\$?(\d+\.?\d*)', price_text)
                    if m:
                        price = float(m.group(1))

                    if name:
                        items.append({
                            "store": "aldi",
                            "name": name + " [Weekly Special]",
                            "price": price,
                            "scraped_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
                        })
                except Exception:
                    continue
        except Exception as e:
            logger.debug(f"Aldi weekly specials failed: {e}")

        return items
