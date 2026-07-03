"""
Stealth helpers for avoiding bot detection.

Applies in-memory patches to the page context before navigation.
These run AFTER the page object is created but BEFORE navigating to the target site.
"""
import random
import time
import logging
from typing import Optional

logger = logging.getLogger(__name__)


def apply_stealth_js(page) -> None:
    """
    Apply JavaScript patches to hide automation traces.
    Must be called AFTER page creation but BEFORE any navigation.

    Overrides:
    - navigator.webdriver (set to false/undefined)
    - chrome.runtime (fake)
    - permissions (realistic)
    - plugins (realistic length)
    - languages (en-US)
    - platform (Linux x86_64)
    - hardwareConcurrency (4-8)
    - deviceMemory (4-8 GB)
    """
    stealth_script = r"""
    // Override the webdriver property
    Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
        configurable: true,
    });

    // Override plugins array to look real
    Object.defineProperty(navigator, 'plugins', {
        get: () => {
            const plugins = [
                { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
                { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
                { name: 'Native Client', filename: 'internal-nacl-plugin' },
            ];
            plugins.item = (i) => plugins[i];
            plugins.namedItem = (n) => plugins.find(p => p.name === n);
            plugins.length = plugins.length;
            return plugins;
        },
        configurable: true,
    });

    // Override languages
    Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
        configurable: true,
    });

    // Override platform
    Object.defineProperty(navigator, 'platform', {
        get: () => 'Linux x86_64',
        configurable: true,
    });

    // Override hardwareConcurrency
    Object.defineProperty(navigator, 'hardwareConcurrency', {
        get: () => 8,
        configurable: true,
    });

    // Override deviceMemory
    Object.defineProperty(navigator, 'deviceMemory', {
        get: () => 8,
        configurable: true,
    });

    // Override permissions API to quiet automated checks
    const originalQuery = navigator.permissions.query;
    navigator.permissions.query = async (params) => {
        const result = { state: 'prompt', onchange: null };
        const denied = ['camera', 'microphone', 'geolocation', 'notifications',
                        'midi', 'clipboard-read', 'clipboard-write', 'payment-handler'];
        if (denied.includes(params.name)) {
            result.state = 'denied';
            result.onchange = null;
            Object.defineProperty(result, 'state', {
                get: () => { return 'denied'; },
                configurable: true,
            });
        }
        result.addEventListener = () => {};
        result.removeEventListener = () => {};
        return Promise.resolve(result);
    };

    // Override webdriver active property
    if (window.cdc_adoQpoasnfa76pfcZLmcfl) {
        delete window.cdc_adoQpoasnfa76pfcZLmcfl;
    }

    // Override outer window detection
    Object.defineProperty(window, 'outerWidth', { value: window.innerWidth || 1920 });
    Object.defineProperty(window, 'outerHeight', { value: window.innerHeight || 1080 });

    // Remove frame element (anti-frame-detection)
    Object.defineProperty(window, 'frameElement', { get: () => null });
    """

    page.add_init_script(stealth_script)


def human_delay(min_s: float = 0.5, max_s: float = 2.0) -> float:
    """Sleep for a random human-like delay."""
    delay = random.uniform(min_s, max_s)
    import time
    time.sleep(delay)
    return delay


def human_type(page, selector: str, text: str, **kwargs):
    """Type text with human-like delays between characters."""
    for char in text:
        page.fill(selector, "") if char == text[0] else None
        page.type(selector, char, delay=random.randint(40, 180))
        import time
        time.sleep(random.uniform(0.01, 0.08))
    # Final fill to ensure correctness
    page.fill(selector, text)


def random_scroll(page, num_scrolls: int = 3):
    """Perform random scrolls like a human reading a page."""
    for _ in range(num_scrolls):
        delta_y = random.randint(200, 800)
        page.evaluate(f"window.scrollBy(0, {delta_y})")
        time.sleep(random.uniform(0.5, 2.0))
    # Scroll back up a bit
    page.evaluate("window.scrollBy(0, -200)")
    time.sleep(random.uniform(0.3, 1.0))
