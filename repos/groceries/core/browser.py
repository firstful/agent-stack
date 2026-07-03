"""
Undetectable browser automation framework.
Connects to the real desktop display (XWayland via DISPLAY=:1)
using persistent Chromium profiles for each site,
making automation indistinguishable from a real user session.
"""
import os
import json
import time
import random
import logging
import subprocess
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# ─── Environment Detection ───────────────────────────────────────────────

def detect_display() -> dict:
    """
    Detect the real user's display environment.
    Returns env vars dict suitable for os.environ.update() or subprocess env=.

    Priority:
    1. DISPLAY=:1 (XWayland) with reeds' Xauthority
    2. WAYLAND_DISPLAY=wayland-0 with XDG_RUNTIME_DIR
    """
    home = Path.home()
    reeds_home = Path("/home/reeds")
    runtime_dir = Path("/run/user/1000")
    xauth_paths = [
        runtime_dir / "xauth_fEFHsn",
        reeds_home / ".Xauthority",
    ]

    env = {}

    # Prefer XWayland — Chromium is most stable here
    if (runtime_dir / "wayland-0").exists():
        env["DISPLAY"] = ":1"
        for xa in xauth_paths:
            if xa.exists():
                env["XAUTHORITY"] = str(xa)
                break
        env["XDG_RUNTIME_DIR"] = str(runtime_dir)

    # Check Wayland socket as fallback
    if not env.get("DISPLAY") and (runtime_dir / "wayland-0").exists():
        env["WAYLAND_DISPLAY"] = "wayland-0"
        env["XDG_RUNTIME_DIR"] = str(runtime_dir)

    # DBus for native notifications / credential prompts
    bus_path = runtime_dir / "bus"
    if bus_path.exists():
        env["DBUS_SESSION_BUS_ADDRESS"] = f"unix:path={bus_path}"

    logger.info(f"Display environment: DISPLAY={env.get('DISPLAY','')} "
                f"WAYLAND={env.get('WAYLAND_DISPLAY','')}")
    return env


def run_on_display(cmd: list[str], **kwargs) -> subprocess.CompletedProcess:
    """Run a command with the real user's display environment."""
    display_env = detect_display()
    env = os.environ.copy()
    env.update(display_env)
    if "env" in kwargs:
        env.update(kwargs.pop("env"))
    return subprocess.run(cmd, env=env, **kwargs)


# ─── Profile Management ──────────────────────────────────────────────────

PROFILES_DIR = Path(__file__).resolve().parent.parent / "profiles"
PROFILES_DIR.mkdir(parents=True, exist_ok=True)

SITE_CONFIGS = {
    "walmart": {
        "domain": "walmart.com",
        "login_url": "https://www.walmart.com/account/login",
        "orders_url": "https://www.walmart.com/orders",
        "home_url": "https://www.walmart.com",
        "chromium_args": [],
    },
    "samsclub": {
        "domain": "samsclub.com",
        "login_url": "https://www.samsclub.com/account/login",
        "orders_url": "https://www.samsclub.com/orders",
        "home_url": "https://www.samsclub.com",
        "chromium_args": [],
    },
    "aldi": {
        "domain": "aldi.us",
        "login_url": "https://www.aldi.us/en/account/login/",
        "orders_url": "https://www.aldi.us/en/account/order-history/",
        "home_url": "https://www.aldi.us",
        "chromium_args": [],
    },
    "amazon": {
        "domain": "amazon.com",
        "login_url": "https://www.amazon.com/ap/signin",
        "orders_url": "https://www.amazon.com/your-orders",
        "home_url": "https://www.amazon.com",
        "chromium_args": [
            "--disable-features=TranslateUI",
        ],
    },
    "kroger": {
        "domain": "kroger.com",
        "login_url": "https://www.kroger.com/signin",
        "orders_url": "https://www.kroger.com/ordertracker/order-history",
        "home_url": "https://www.kroger.com",
        "chromium_args": [],
    },
}


def profile_dir(site: str) -> Path:
    """Get the persistent Chromium profile directory for a given site."""
    p = PROFILES_DIR / site / "chromium-profile"
    p.mkdir(parents=True, exist_ok=True)
    return p


def screenshot_dir(site: str) -> Path:
    """Directory for debug screenshots."""
    p = PROFILES_DIR / site / "screenshots"
    p.mkdir(parents=True, exist_ok=True)
    return p


def session_state_path(site: str) -> Path:
    """Path to store Playwright storage state (cookies + localStorage)."""
    p = PROFILES_DIR / site / "storage_state.json"
    return p


# ─── Chromium Launcher (Playwright-based) ────────────────────────────────

def get_launch_kwargs(site: str, headless: bool = False, **extra) -> dict:
    """
    Build Playwright launch kwargs for realistic, undetectable browsing.

    NOTE: Playwright 1.61+ does NOT accept ``user_data_dir`` in
    ``browser_type.launch()``.  Use ``launch_persistent_context()``
    together with `get_persistent_launch_kwargs()` instead.

    Returns kwargs suitable for ``browser_type.launch(**kwargs)``.
    """
    site_cfg = SITE_CONFIGS[site]

    args = [
        # Disable automation-warning banner
        "--disable-blink-features=AutomationControlled",
        # Use real GPU (AMD RX 470) instead of SwiftShader
        "--disable-software-rasterizer",
        # Ensure we don't look headless
        "--enable-features=NetworkService,NetworkServiceInProcess",
        # Disable various telemetry
        "--disable-background-networking",
        "--disable-sync",
        "--disable-default-apps",
        "--disable-translate",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-breakpad",
    ]

    # Site-specific args
    args.extend(site_cfg.get("chromium_args", []))

    kwargs = {
        # Use the system-installed Chromium, not Playwright's bundled one
        "executable_path": "/usr/bin/chromium",
        "headless": headless,
        "args": args,
        # We are connecting to a real display — no sandbox issues
        "ignore_default_args": ["--enable-automation"],
        "env": detect_display(),
        # Increase timeouts for slow grocery sites
        "timeout": 60_000,
    }
    kwargs.update(extra)
    return kwargs


def get_persistent_launch_kwargs(site: str, headless: bool = False, **extra) -> dict:
    """
    Build kwargs for ``browser_type.launch_persistent_context()``.

    This is the modern Playwright API for using a persistent user data
    directory (cookies, localStorage survive restarts).  It combines
    browser launch *and* context creation into one call.

    Returns kwargs suitable for::

        context = browser_type.launch_persistent_context(
            user_data_dir=str(profile_dir(site)),
            **get_persistent_launch_kwargs(site, headless=headless),
        )
    """
    site_cfg = SITE_CONFIGS[site]

    args = [
        "--disable-blink-features=AutomationControlled",
        "--disable-software-rasterizer",
        "--enable-features=NetworkService,NetworkServiceInProcess",
        "--disable-background-networking",
        "--disable-sync",
        "--disable-default-apps",
        "--disable-translate",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-breakpad",
    ]
    args.extend(site_cfg.get("chromium_args", []))

    # Base kwargs match what launch_persistent_context accepts
    kwargs: dict = {
        "executable_path": "/usr/bin/chromium",
        "headless": headless,
        "args": args,
        "ignore_default_args": ["--enable-automation"],
        "env": detect_display(),
        "timeout": 60_000,
        # Persistent context also accepts context-level options
        "viewport": {
            "width": random.choice([1366, 1440, 1536, 1600, 1920]),
            "height": random.choice([768, 900, 864, 900, 1080]),
        },
        "locale": "en-US",
        "timezone_id": "America/New_York",
        "color_scheme": "light",
        "device_scale_factor": 1.0,
        "is_mobile": False,
        "has_touch": False,
        "user_agent": (
            "Mozilla/5.0 (X11; Linux x86_64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/149.0.0.0 Safari/537.36"
        ),
        "accept_downloads": True,
    }
    kwargs.update(extra)
    return kwargs


def get_context_kwargs(site: str, **extra) -> dict:
    """
    Build a browser context kwargs dict with stealth-friendly defaults.

    - Realistic viewport (randomized per session within common bounds)
    - Locale: en-US
    - Geolocation: Columbus, OH area (Pickerington)
    - Timezone: America/New_York
    - Color scheme: light (most common)
    - Record video for troubleshooting
    """
    viewport = {
        "width": random.choice([1366, 1440, 1536, 1600, 1920]),
        "height": random.choice([768, 900, 864, 900, 1080]),
    }

    kwargs = {
        "viewport": viewport,
        "locale": "en-US",
        "timezone_id": "America/New_York",
        "color_scheme": "light",
        "device_scale_factor": 1.0,
        "is_mobile": False,
        "has_touch": False,
        "user_agent": (
            "Mozilla/5.0 (X11; Linux x86_64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/149.0.0.0 Safari/537.36"
        ),
        # Load saved cookies if available
        "storage_state": _load_storage_state(site),
        # Accept all cookies / dialogs
        "accept_downloads": True,
    }
    kwargs.update(extra)
    return kwargs


def _load_storage_state(site: str):
    """Load saved storage state (cookies + localStorage) if it exists."""
    path = session_state_path(site)
    if path.exists():
        try:
            with open(path) as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            logger.warning(f"Corrupt storage state for {site}, starting fresh")
    return None


def save_storage_state(page, site: str):
    """Persist current cookies + localStorage to disk."""
    import playwright.sync_api
    if hasattr(page, "context"):
        state = page.context.storage_state()
        path = session_state_path(site)
        with open(path, "w") as f:
            json.dump(state, f, indent=2)
        logger.info(f"Saved storage state for {site} ({len(state.get('cookies',[]))} cookies)")
    else:
        logger.warning(f"save_storage_state: page has no context")
