#!/usr/bin/env python3
"""Debug Amazon sign-in page — dump what's actually there."""
import logging, sys, json
logging.basicConfig(level=logging.INFO, format='%(message)s')

from playwright.sync_api import sync_playwright
from core import get_persistent_launch_kwargs, profile_dir, apply_stealth_js

with sync_playwright() as pw:
    ctx = pw.chromium.launch_persistent_context(
        str(profile_dir("amazon")),
        **get_persistent_launch_kwargs("amazon", headless=False),
    )
    page = ctx.pages[0] if ctx.pages else ctx.new_page()
    apply_stealth_js(page)
    page.on("dialog", lambda d: d.dismiss())

    # Go to sign-in
    page.goto("https://www.amazon.com/ap/signin", wait_until="domcontentloaded", timeout=30000)

    import time
    time.sleep(5)

    # Dump what we see
    print(f"\nURL: {page.url}")
    print(f"Title: {page.title()}")

    # List all input fields
    inputs = page.query_selector_all("input")
    print(f"\nInput fields ({len(inputs)}):")
    for inp in inputs:
        name = inp.get_attribute("name") or ""
        id_ = inp.get_attribute("id") or ""
        type_ = inp.get_attribute("type") or ""
        placeholder = inp.get_attribute("placeholder") or ""
        visible = inp.is_visible()
        print(f"  name={name:30s} id={id_:30s} type={type_:10s} placeholder={placeholder:20s} visible={visible}")

    # List all buttons
    buttons = page.query_selector_all("button, input[type='submit']")
    print(f"\nButtons ({len(buttons)}):")
    for btn in buttons:
        text = btn.inner_text().strip()[:30] if hasattr(btn, 'inner_text') else ""
        id_ = btn.get_attribute("id") or ""
        print(f"  id={id_:30s} text={text}")

    # Body text (first 2000 chars)
    body = page.inner_text("body")[:2000]
    print(f"\nBody text:\n{body}\n")

    # Screenshot
    page.screenshot(path="amazon_debug.png")
    print("Screenshot saved to amazon_debug.png")

    ctx.close()
