#!/usr/bin/env python3
"""Debug Amazon MFA page — take screenshot and dump page state."""
import logging, json
logging.basicConfig(level=logging.INFO, format='%(levelname)s:%(name)s:%(message)s')

from scrapers.amazon import AmazonScraper

with open('profiles/credentials.json') as f:
    creds = json.load(f).get('amazon', {})

with AmazonScraper(headless=False) as scraper:
    ok = scraper.login(creds['user'], creds['pass'], totp_secret=creds.get('totp'))
    print(f'\nLogin: {ok}')
    print(f'URL: {scraper.page.url}')
    
    # Dump page state
    from playwright.sync_api import sync_playwright
    body = scraper.page.inner_text("body")[:3000]
    print(f'\n=== BODY TEXT ===\n{body}\n')
    
    # All visible buttons
    buttons = scraper.page.query_selector_all("button, a[href], input[type='submit']")
    print(f'\n=== BUTTONS ({len(buttons)}) ===')
    for b in buttons:
        if b.is_visible():
            print(f'  text=[{b.inner_text().strip()[:50]}] tag={b.evaluate("e => e.tagName")} id={b.get_attribute("id") or ""}')
    
    # All visible inputs
    inputs = scraper.page.query_selector_all("input:not([type='hidden'])")
    print(f'\n=== INPUTS ({len(inputs)}) ===')
    for inp in inputs:
        if inp.is_visible():
            print(f'  name={inp.get_attribute("name") or ""} type={inp.get_attribute("type") or ""} id={inp.get_attribute("id") or ""}')
    
    scraper.page.screenshot(path="profiles/amazon/screenshots/mfa_debug.png")
    print('\nScreenshot: profiles/amazon/screenshots/mfa_debug.png')
