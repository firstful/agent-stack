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
from core import human_delay, random_scroll

logger = logging.getLogger(__name__)


class AmazonScraper(BaseScraper):
    SITE_NAME = "amazon"
    LOGIN_URL = "https://www.amazon.com"  # Sign in by clicking homepage link
    ORDERS_URL = "https://www.amazon.com/your-orders"

    def login(self, username: str, password: str, totp_secret: str | None = None) -> bool:
        """Login to Amazon with human-like delays.

        If *totp_secret* is provided, the TOTP code is generated and
        auto‑filled when Amazon prompts for a verification code.
        """
        logger.info("Logging into Amazon...")

        # Pre-warm: visit homepage first like a real user
        self.goto("https://www.amazon.com", wait_until="networkidle")
        human_delay(2, 4)
        random_scroll(self.page, 2)

        # Click the "Sign in" link on the homepage — this generates the
        # correct OpenID redirect URL (ap/signin without query params 404s)
        signin_clicked = False
        for selector in [
            "a[href*='ap/signin']",
            "a[href*='signin']",
            "#nav-link-accountList",
            "[data-nav-role='signin']",
            "a:has-text('Sign in')",
        ]:
            try:
                links = self.page.query_selector_all(selector)
                for link in links:
                    if link.is_visible():
                        href = link.get_attribute("href") or ""
                        text = link.inner_text().strip().lower()
                        if "sign" in text or "account" in text or "ap/signin" in href:
                            link.click()
                            signin_clicked = True
                            logger.info("Clicked sign-in link via selector: %s", selector)
                            break
                if signin_clicked:
                    break
            except Exception:
                continue

        if not signin_clicked:
            # Fallback: navigate with OpenID params manually
            logger.warning("No sign-in link found, trying direct URL")
            self.goto(
                "https://www.amazon.com/ap/signin?"
                "openid.return_to=https://www.amazon.com/"
                "&openid.identity=http://specs.openid.net/auth/2.0/identifier_select"
                "&openid.assoc_handle=usflex"
                "&openid.mode=checkid_setup"
                "&openid.claimed_id=http://specs.openid.net/auth/2.0/identifier_select"
                "&openid.ns=http://specs.openid.net/auth/2.0",
                wait_until="networkidle",
            )

        time.sleep(random.uniform(2, 4))

        # Amazon sign-in: email first — press Enter instead of clicking
        # a specific button (Amazon changes button selectors frequently)
        email_selectors = [
            "input[name='email']",
            "input[type='email']",
            "input[id='ap_email']",
        ]
        email_filled = False
        for sel in email_selectors:
            el = self.page.query_selector(sel)
            if el and el.is_visible():
                self.safe_fill(sel, username)
                email_filled = True
                break

        if email_filled:
            time.sleep(random.uniform(1, 2))
            self.page.keyboard.press("Enter")
            time.sleep(random.uniform(2, 4))
        else:
            logger.warning("Could not find email field, trying page body")
            self.screenshot("amazon_email_not_found")

        # Password
        pw_selectors = [
            "input[name='password']",
            "input[type='password']",
            "input[id='ap_password']",
        ]
        pw_filled = False
        for sel in pw_selectors:
            el = self.page.query_selector(sel)
            if el and el.is_visible():
                self.safe_fill(sel, password)
                pw_filled = True
                break

        if pw_filled:
            time.sleep(random.uniform(1, 2))
            self.page.keyboard.press("Enter")
            time.sleep(random.uniform(3, 5))
        elif email_filled:
            # Maybe we're on the password page already (Enter advanced it)
            time.sleep(2)
            for sel in pw_selectors:
                el = self.page.query_selector(sel)
                if el and el.is_visible():
                    self.safe_fill(sel, password)
                    time.sleep(1)
                    self.page.keyboard.press("Enter")
                    time.sleep(random.uniform(3, 5))
                    pw_filled = True
                    break
            if not pw_filled:
                logger.warning("Could not find password field either")
                self.screenshot("amazon_password_not_found")

        # ── Auto-fill TOTP if we have the secret ──────────────────────
        if totp_secret:
            self._auto_fill_totp(totp_secret)

        # Fall back to waiting for manual entry on the real display
        logged_in = self.wait_for_login_complete(wait_seconds=180)

        # If we got past login but landed on an MFA page, try navigating
        # to orders directly — Amazon often completes MFA on the way
        if logged_in and "/ap/mfa" in self.page.url:
            logger.info("On MFA page after login — navigating to orders to finalize")
            try:
                self.goto("https://www.amazon.com/your-orders", wait_until="domcontentloaded")
                time.sleep(3)
                # If still on MFA, try _complete_mfa
                if "/ap/mfa" in self.page.url:
                    if self._complete_mfa():
                        self.goto("https://www.amazon.com/your-orders", wait_until="domcontentloaded")
                        time.sleep(2)
                # Check if we made it past MFA
                if "/ap/mfa" not in self.page.url:
                    self.save_state()
                    logged_in = True
            except Exception:
                pass

        return logged_in

    def _auto_fill_totp(self, totp_secret: str) -> bool:
        """If Amazon prompts for a verification code, generate and fill it.

        Returns True if the TOTP was submitted, False if no prompt found.
        """
        import pyotp

        # Strip spaces the user may have pasted
        secret = totp_secret.replace(" ", "")
        totp = pyotp.TOTP(secret)
        code = totp.now()

        logger.info("TOTP code generated, looking for OTP prompt...")

        # Amazon shows the OTP prompt a few seconds after login
        for attempt in range(15):  # up to ~30 seconds
            time.sleep(2)
            try:
                body_text = self.page.inner_text("body")

                # Check if we're already past the OTP page
                if "Hello, " in body_text or "Your Account" in body_text:
                    logger.info("Already logged in, no OTP needed")
                    return True

                # Look for OTP input
                otp_input = self.page.query_selector(
                    "input[type='tel'][name*='code'], "
                    "input[type='tel'][id*='code'], "
                    "input[name*='otp'], input[id*='otp'], "
                    "input[type='tel'][aria-label*='code'], "
                    "input[type='tel'][aria-label*='OTP']"
                )
                if otp_input:
                    logger.info(f"OTP prompt detected, filling code: {code}")
                    otp_input.fill(str(code))
                    time.sleep(1.5)

                    # Amazon often auto-submits when 6 digits are entered.
                    # If not, press Enter as fallback.
                    try:
                        self.page.keyboard.press("Enter")
                        time.sleep(2)
                    except Exception:
                        pass

                    logger.info("TOTP code submitted")
                    return True

                # Another common Amazon phrasing
                if "verification code" in body_text.lower() or "enter otp" in body_text.lower():
                    # Find any visible text input
                    inputs = self.page.query_selector_all(
                        "input[type='text'], input[type='tel'], input:not([type='hidden'])"
                    )
                    for inp in inputs:
                        if inp.is_visible():
                            logger.info(f"Verification code field found, filling: {code}")
                            inp.fill(str(code))
                            time.sleep(1)
                            self.page.keyboard.press("Enter")
                            time.sleep(2)
                            return True

            except Exception as e:
                logger.debug(f"TOTP check attempt {attempt}: {e}")
                continue

        logger.warning("No OTP prompt detected within timeout — continuing")
        return False

    def _check_logged_in(self) -> bool:
        """Amazon-specific logged-in check."""
        try:
            self.page.wait_for_timeout(3000)
            body_text = self.page.inner_text("body")

            # OTP/2FA challenge
            if "Enter OTP" in body_text or "verification code" in body_text.lower():
                logger.info("Amazon OTP challenge detected — waiting for manual entry")
                return False

            # MFA approval page (after TOTP, before fully logged in)
            if "/ap/mfa" in self.page.url:
                logger.info("Amazon MFA page — completing verification")
                if self._complete_mfa():
                    return True  # Don't call save_state again here

            # Logged-in indicators
            if "Hello, " in body_text or "Your Account" in body_text or "Your Orders" in body_text:
                return True

            # URL-based check (redirected to home)
            if "amazon.com" in self.page.url and "ap/signin" not in self.page.url and "/ap/" not in self.page.url:
                return True

        except Exception:
            pass
        return False

    def _complete_mfa(self) -> bool:
        """Complete the Amazon MFA approval page after TOTP.

        Amazon sometimes shows a /ap/mfa page asking you to:
        - Click 'Approve' in the Amazon app
        - Enter a code sent via SMS
        - Or just click 'Continue'

        Returns True when past the MFA page.
        """
        logger.info("Checking MFA page for completion options...")
        time.sleep(2)

        try:
            body = self.page.inner_text("body").lower()

            # If there's a 'Continue' or 'Done' button on the MFA page, click it
            for btn_text in ["continue", "done", "approve", "got it"]:
                btn = self.page.query_selector(
                    f"input[value='{btn_text}'], "
                    f"input[value='{btn_text.capitalize()}'], "
                    f"button:has-text('{btn_text}'), "
                    f"a:has-text('{btn_text}')"
                )
                if btn and btn.is_visible():
                    logger.info(f"Clicking MFA '{btn_text}' button")
                    btn.click()
                    time.sleep(3)
                    # Check if we're past MFA
                    if "/ap/mfa" not in self.page.url:
                        self.save_state()
                        return True

            # If there's a code input (SMS code), we can't auto-fill that
            # — wait for manual entry
            code_input = self.page.query_selector(
                "input[type='tel'], input[name*='code'], input[id*='code']"
            )
            if code_input and code_input.is_visible():
                logger.warning("MFA code input detected — needs manual entry")
                return False

            # If none of the above, maybe the page auto-advances
            for _ in range(15):
                time.sleep(2)
                if "/ap/mfa" not in self.page.url:
                    self.save_state()
                    return True

        except Exception as e:
            logger.debug(f"MFA completion check: {e}")

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
