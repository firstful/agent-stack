"""
Base scraper class that all site scrapers inherit from.
Handles common lifecycle: launch, context, page setup, login, scrape, teardown.
"""
import os
import json
import time
import random
import logging
from pathlib import Path
from abc import ABC, abstractmethod
from typing import Optional

from core import (
    get_persistent_launch_kwargs, save_storage_state,
    apply_stealth_js, human_delay, random_scroll,
    session_state_path, screenshot_dir, detect_display, profile_dir,
)

logger = logging.getLogger(__name__)


class BaseScraper(ABC):
    """Abstract base for a grocery site scraper."""

    # Override in subclasses
    SITE_NAME: str = ""
    LOGIN_URL: str = ""
    ORDERS_URL: str = ""

    def __init__(self, headless: bool = False, record_video: bool = False):
        self.headless = headless
        self.record_video = record_video
        self.browser = None
        self.context = None
        self.page = None
        self.authenticated = False

    # ─── Lifecycle ────────────────────────────────────────────────────────

    def launch(self):
        """Launch browser with persistent context (Playwright 1.61+ API)."""
        from playwright.sync_api import sync_playwright

        self._pw = sync_playwright().start()

        persistent_kwargs = get_persistent_launch_kwargs(
            self.SITE_NAME, headless=self.headless,
        )
        if self.record_video:
            vid_dir = screenshot_dir(self.SITE_NAME) / "videos"
            persistent_kwargs["record_video_dir"] = str(vid_dir)

        logger.info(f"Launching {self.SITE_NAME} scraper...")

        # launch_persistent_context returns a BrowserContext, not a Browser.
        # The persistent user data dir is passed as the first positional arg.
        self.context = self._pw.chromium.launch_persistent_context(
            str(profile_dir(self.SITE_NAME)),
            **persistent_kwargs,
        )
        # Use the initial about:blank page — don't close it or try new_page()
        self.page = self.context.pages[0] if self.context.pages else self.context.new_page()

        # Apply stealth patches
        apply_stealth_js(self.page)

        # Handle dialogs automatically
        self.page.on("dialog", lambda d: d.dismiss())

        logger.info(f"Browser launched for {self.SITE_NAME}")

    def close(self):
        """Teardown context and Playwright."""
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
        if hasattr(self, '_pw') and self._pw:
            try:
                self._pw.stop()
            except Exception:
                pass

    def __enter__(self):
        self.launch()
        return self

    def __exit__(self, *args):
        self.close()

    # ─── Navigation ───────────────────────────────────────────────────────

    def goto(self, url: str, wait_until: str = "networkidle", **kwargs):
        """Navigate and wait for the page to settle."""
        logger.info(f"Navigating to {url}")
        resp = self.page.goto(url, wait_until=wait_until, **kwargs)
        human_delay(1.0, 3.0)
        return resp

    def safe_click(self, selector: str, timeout: int = 15000, **kwargs):
        """Wait for an element then click it with human delay."""
        import time
        self.page.wait_for_selector(selector, timeout=timeout)
        time.sleep(random.uniform(0.3, 1.2))
        self.page.click(selector, **kwargs)
        human_delay()

    def safe_fill(self, selector: str, text: str, simulate_typing: bool = True):
        """Fill an input field, optionally with human-like typing."""
        self.page.wait_for_selector(selector, timeout=15000)
        if simulate_typing:
            for char in text:
                self.page.type(selector, char, delay=random.randint(40, 180))
                time.sleep(random.uniform(0.01, 0.05))
            # Ensure correctness
            self.page.fill(selector, text)
        else:
            self.page.fill(selector, text)
        human_delay(0.2, 0.8)

    def save_state(self):
        """Save cookies + localStorage for reuse."""
        save_storage_state(self.page, self.SITE_NAME)
        self.authenticated = True

    # ─── Login Flow ───────────────────────────────────────────────────────

    def restore_session(self) -> bool:
        """Try to restore a previously-saved session by navigating to orders.

        Uses the persistent Chromium profile (cookies survive across launches
        via ``launch_persistent_context``).  Returns True if already
        authenticated, False if login is needed.
        """
        if not self.ORDERS_URL:
            return False

        logger.info("Attempting session restore — going straight to orders...")
        try:
            self.goto(self.ORDERS_URL, wait_until="domcontentloaded")
            time.sleep(3)

            if self._check_logged_in():
                logger.info("Session restore successful — already authenticated")
                self.save_state()
                return True

            logger.info("Session restore failed — not authenticated, proceeding to login")
        except Exception as e:
            logger.debug(f"Session restore error: {e}")

        return False

    def login(self, username: str = "", password: str = "", **kwargs) -> bool:
        """Template method: try session restore first, then perform login.

        Subclasses implement ``_do_login()`` for their site-specific flow.
        """
        if self.restore_session():
            return True
        return self._do_login(username, password, **kwargs)

    @abstractmethod
    def _do_login(self, username: str, password: str, **kwargs) -> bool:
        """Site-specific login logic. Called only when session restore fails."""
        ...

    def wait_for_login_complete(self, wait_seconds: int = 120) -> bool:
        """
        After filling credentials, wait for login to complete.
        Some sites do MFA, 2FA, or Captcha — this gives time for
        the user to manually complete them on the real display.

        Returns True if we're past the login page (URL changed / element appears).
        """
        import urllib.parse

        original_url = self.page.url
        logger.info(f"Waiting up to {wait_seconds}s for manual login completion...")

        start = time.time()
        while time.time() - start < wait_seconds:
            current = self.page.url

            # Check if URL has changed significantly (past login)
            if self._url_past_login(original_url, current):
                logger.info(f"Login detected — URL changed to {current}")
                self.save_state()
                return True

            # Check for logged-in indicator elements
            if self._check_logged_in():
                logger.info("Login detected via page indicator")
                self.save_state()
                return True

            time.sleep(2)

        logger.warning(f"Login wait expired ({wait_seconds}s)")
        return False

    def _url_past_login(self, original: str, current: str) -> bool:
        """Check if URL change indicates successful login."""
        import urllib.parse
        orig_host = urllib.parse.urlparse(original).hostname or ""
        curr_host = urllib.parse.urlparse(current).hostname or ""
        orig_path = urllib.parse.urlparse(original).path or ""
        curr_path = urllib.parse.urlparse(current).path or ""
        # Must still be on the same domain
        if orig_host != curr_host:
            return False
        # Path shouldn't be the login path anymore
        login_paths = ["login", "signin", "sign-in", "log-in", "auth", "ap/signin", "ap/mfa"]
        is_still_login = any(p in curr_path.lower() for p in login_paths)
        return not is_still_login

    def _check_logged_in(self) -> bool:
        """Override in subclasses to check for site-specific logged-in indicator."""
        return False

    # ─── Scraping ─────────────────────────────────────────────────────────

    @abstractmethod
    def scrape_orders(self, max_orders: int = 50) -> list[dict]:
        """Scrape past orders. Returns list of order dicts."""
        ...

    def scrape_current_prices(self, zip_code: str = "43147") -> list[dict]:
        """Scrape current prices at nearby locations."""
        logger.info(f"{self.SITE_NAME} price scraping not implemented")
        return []

    def screenshot(self, name: str = "debug"):
        """Take a screenshot for debugging."""
        path = screenshot_dir(self.SITE_NAME) / f"{name}_{int(time.time())}.png"
        self.page.screenshot(path=str(path))
        logger.info(f"Screenshot saved: {path}")
        return path
