"""
Harmony: Grocery Automation Agent

Main orchestration script that ties together:
- Browser automation (undetectable, headed)
- Site-specific scrapers (Walmart, Sam's Club, Amazon, Kroger, Aldi)
- Database storage
- Order planning & price optimization
- Outage forecasting

Usage:
  python3 main.py login <site>       # Interactive login for a site
  python3 main.py scrape-orders      # Scrape all registered sites
  python3 main.py scrape-prices      # Scrape current prices nearby
  python3 main.py forecast           # Run outage forecasting
  python3 main.py plan               # Generate shopping plan
  python3 main.py interactive        # Login with visual browser, do initial scrape
"""
import os
import sys
import json
import time
import random
import logging
import argparse
from pathlib import Path
from datetime import datetime
from typing import Optional

# ─── Setup logging ───────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("main")

# Suppress noisy libraries
logging.getLogger("playwright").setLevel(logging.WARNING)

# ─── Imports ─────────────────────────────────────────────────────────────
from scrapers import WalmartScraper, SamsClubScraper, AmazonScraper, KrogerScraper, AldiScraper
from storage import get_engine, init_db, get_session, store_order, DB_PATH
from planners import normalize_product_name, is_match, find_best_match, group_products
from planners.price_optimizer import best_price_across_stores, price_summary, sale_detection
from planners.forecaster import build_purchase_patterns, get_due_items, shopping_list_summary
from models import StoredItem, Order, PriceHistory, PurchasePattern, Store

# ─── Config ──────────────────────────────────────────────────────────────

CREDENTIALS_FILE = Path(__file__).parent / "profiles" / "credentials.json"
SITES = ["walmart", "samsclub", "amazon", "kroger", "aldi"]
LOCAL_ZIP = "43147"
LOCAL_CITY = "Pickerington"
LOCAL_STATE = "OH"

SCRAPER_MAP = {
    "walmart": WalmartScraper,
    "samsclub": SamsClubScraper,
    "amazon": AmazonScraper,
    "kroger": KrogerScraper,
    "aldi": AldiScraper,
}


# ─── Credential Management ───────────────────────────────────────────────

def load_credentials() -> dict:
    """Load stored credentials from vault (preferred) or local file."""
    # Try to export from vault first
    profiles_dir = Path(__file__).parent / "profiles"
    export_script = profiles_dir / "export_creds.py"
    if export_script.exists():
        try:
            import subprocess
            subprocess.run(
                [sys.executable, str(export_script)],
                capture_output=True, timeout=30,
            )
        except Exception:
            pass

    if CREDENTIALS_FILE.exists():
        with open(CREDENTIALS_FILE) as f:
            return json.load(f)
    return {}


def save_credentials(creds: dict):
    """Save credentials (encrypted/stored locally). TODO: add encryption."""
    CREDENTIALS_FILE.parent.mkdir(parents=True, exist_ok=True)
    # Save with restricted permissions
    with open(CREDENTIALS_FILE, "w") as f:
        json.dump(creds, f, indent=2)
    os.chmod(CREDENTIALS_FILE, 0o600)
    logger.info(f"Credentials saved to {CREDENTIALS_FILE}")


def prompt_credentials(site: str) -> tuple[str, str]:
    """Prompt for credentials interactively, store them."""
    print(f"\n=== {site.upper()} Login ===")
    username = input(f"  {site} email/username: ").strip()
    import getpass
    password = getpass.getpass(f"  {site} password: ").strip()
    return username, password


# ─── Core Operations ─────────────────────────────────────────────────────

def interactive_login(site: str):
    """
    Open browser on the real display for interactive login.
    User completes MFA / captcha on the real desktop.
    """
    logger.info(f"Starting interactive login for {site}...")
    logger.info(f"  Browser will open on your desktop display (:1)")

    scraper_class = SCRAPER_MAP.get(site)
    if not scraper_class:
        logger.error(f"Unknown site: {site}. Choose from: {', '.join(SITES)}")
        return False

    creds = load_credentials()
    site_creds = creds.get(site, {})
    username = site_creds.get("username", "")
    password = site_creds.get("password", "")

    if not username or not password:
        logger.info(f"No stored credentials for {site}, need to prompt")
        username, password = prompt_credentials(site)

    scraper = scraper_class(headless=False)
    try:
        scraper.launch()
        logger.info("Browser window open on your desktop. Complete any 2FA/MFA if prompted.")
        success = scraper.login(username, password)

        if success:
            logger.info(f"✅ Successfully logged into {site}!")
            # Save credentials (if new)
            if site not in creds:
                creds[site] = {"username": username, "password": password}
                save_credentials(creds)
            scraper.screenshot(f"{site}_logged_in")
        else:
            logger.warning(f"⚠️  Login may not have completed for {site} (2FA wait expired)")

        return success
    finally:
        scraper.close()


def scrape_all_orders(max_per_site: int = 50):
    """Scrape orders from all authenticated sites."""
    creds = load_credentials()
    all_orders = []
    engine = get_engine()
    init_db(engine)
    session = get_session(engine)

    for site in SITES:
        if site not in creds:
            logger.info(f"Skipping {site} — no credentials stored")
            continue

        site_creds = creds[site]
        scraper_class = SCRAPER_MAP.get(site)
        if not scraper_class:
            continue

        try:
            with scraper_class(headless=False) as scraper:
                # Login
                success = scraper.login(site_creds["username"], site_creds["password"])
                if not success:
                    logger.warning(f"Could not authenticate for {site}, skipping")
                    continue

                # Scrape orders
                orders = scraper.scrape_orders(max_orders=max_per_site)
                logger.info(f"Got {len(orders)} orders from {site}")

                # Store in DB
                for order_data in orders:
                    store_order(session, site, order_data)

                all_orders.extend(orders)
        except Exception as e:
            logger.error(f"Failed to scrape {site}: {e}")
            continue

    session.close()
    logger.info(f"Total orders stored: {len(all_orders)}")
    return all_orders


def scrape_all_prices(zip_code: str = LOCAL_ZIP, stores: list[str] | None = None):
    """Scrape current prices from specified stores near the given zip."""
    creds = load_credentials()
    all_items = []
    engine = get_engine()
    init_db(engine)
    db_session = get_session(engine)

    sites_to_scrape = stores or SITES

    for site in sites_to_scrape:
        # For price scraping, Amazon and Kroger may need auth
        if site in ("amazon", "walmart", "kroger") and site not in creds:
            logger.info(f"Skipping {site} price scrape — needs login credentials")
            continue

        scraper_class = SCRAPER_MAP.get(site)
        if not scraper_class:
            continue

        try:
            with scraper_class(headless=False) as scraper:
                # Login for sites that need it
                if site in creds:
                    site_creds = creds[site]
                    scraper.login(site_creds["username"], site_creds["password"])

                items = scraper.scrape_current_prices(zip_code=zip_code)
                logger.info(f"Got {len(items)} prices from {site}")
                all_items.extend(items)

                # Store in DB
                from datetime import datetime
                now = datetime.now()
                for item in items:
                    ph = PriceHistory(
                        store=site,
                        item_name=item.get("name", ""),
                        sku=item.get("sku", ""),
                        price=item.get("price"),
                        unit_price=item.get("unit_price"),
                        in_stock=item.get("in_stock", True),
                        scraped_at=now,
                    )
                    db_session.add(ph)
                db_session.commit()
        except Exception as e:
            logger.error(f"Failed to scrape prices from {site}: {e}")
            continue

    db_session.close()

    # Save raw JSON for use by other tools
    output_path = Path(__file__).parent / "data" / "latest_prices.json"
    with open(output_path, "w") as f:
        json.dump(all_items, f, indent=2, default=str)
    logger.info(f"Prices saved to {output_path}")

    return all_items


def run_forecast(orders: list[dict] | None = None, days_ahead: int = 7):
    """Run outage forecasting and print results."""
    if not orders:
        # Load from DB
        engine = get_engine()
        session = get_session(engine)
        from models import Order as OrderModel
        db_orders = session.query(OrderModel).all()
        # Convert to dicts
        orders = []
        for o in db_orders:
            orders.append({
                "order_id": o.order_id,
                "store": o.store,
                "order_date": o.order_date.isoformat() if o.order_date else None,
                "total": float(o.total) if o.total else None,
                "items": [{"name": i.item_name, "quantity": i.quantity, "price": float(i.price) if i.price else None}
                          for i in o.items],
            })
        session.close()

    patterns = build_purchase_patterns(orders)
    summary = shopping_list_summary(patterns, days_ahead=days_ahead)

    print(f"\n=== OUTAGE FORECAST ({summary['window_days']}-day window) ===\n")
    print(f"Total tracked patterns: {len(patterns)}")
    print(f"Overdue items: {summary['item_count']['overdue']}")
    print(f"Coming soon: {summary['item_count']['upcoming']}")
    print(f"Suggested stores: {', '.join(summary['suggested_stores'][:3])}")

    if summary["overdue"]:
        print(f"\n--- ⚠️  OVERDUE (buy now!) ---")
        for item in summary["overdue"]:
            print(f"  • {item['item_name']} ({item['store']}) — due {item['days_until_predicted']}d ago")

    if summary["coming_soon"]:
        print(f"\n--- Coming up ---")
        for item in summary["coming_soon"]:
            print(f"  • {item['item_name']} ({item['store']}) — in {item['days_until_predicted']}d")

    print(f"\nPatterns by confidence:")
    for p in patterns[:10]:
        interval_info = f"every {p['median_days_between']}d" if p['median_days_between'] else "irregular"
        print(f"  [{p['confidence']:.0%}] {p['item_name'][:50]:50s} {interval_info} — last {p['total_orders']}x")

    return patterns


def generate_plan(interactive: bool = True):
    """Generate a comprehensive shopping plan."""
    print("=== SHOPPING PLAN GENERATOR ===\n")

    # 1. Load latest prices
    price_file = Path(__file__).parent / "data" / "latest_prices.json"
    if price_file.exists():
        with open(price_file) as f:
            prices = json.load(f)
        print(f"Loaded {len(prices)} price points from latest scrape")
    else:
        prices = []
        print("No price data available. Run 'scrape-prices' first.")

    # 2. Load orders for forecasting
    engine = get_engine()
    session = get_session(engine)
    from models import Order as OrderModel
    db_orders = session.query(OrderModel).all()
    orders = []
    for o in db_orders:
        orders.append({
            "order_id": o.order_id,
            "store": o.store,
            "order_date": o.order_date.isoformat() if o.order_date else None,
            "total": float(o.total) if o.total else None,
            "items": [{"name": i.item_name, "quantity": i.quantity, "price": float(i.price) if i.price else None}
                      for i in o.items],
        })
    session.close()

    # 3. Build forecast
    patterns = build_purchase_patterns(orders) if orders else []
    forecast = shopping_list_summary(patterns, days_ahead=7)

    print(f"\n--- Forecast: {len(patterns)} tracked items ---")
    print(f"  Overdue: {forecast['item_count']['overdue']}")
    print(f"  Coming this week: {forecast['item_count']['upcoming']}")

    # 4. For each upcoming item, find best price across stores
    print(f"\n--- Best Prices for Upcoming Items ---")
    plan_items = []
    for item in forecast.get("overdue", []) + forecast.get("coming_soon", []):
        name = item["item_name"]
        if prices:
            bp = best_price_across_stores(name, prices)
            if bp:
                plan_items.append({
                    "item": name,
                    "best_store": bp["store"],
                    "best_price": bp["price"],
                    "similarity": bp["similarity"],
                    "predicted_days": item["days_until_predicted"],
                    "typical_qty": item["typical_quantity"],
                })
                store_str = f" → ${bp['price']:.2f} at {bp['store']}"
            else:
                store_str = " → no price data"
        else:
            store_str = ""

        print(f"  {'⚠️ ' if item['days_until_predicted'] < 0 else '  '}"
              f"{name[:55]:55s} "
              f"(due in {item['days_until_predicted']}d)"
              f"{store_str}")

    # 5. Sales detection
    if prices:
        sales = sale_detection(prices, prices)
        if sales:
            print(f"\n--- 🔥 CURRENT SALES ---")
            for s in sales[:10]:
                print(f"  {s['item'][:50]:50s} "
                      f"${s['current_price']:.2f} (was ${s['avg_price']:.2f}, "
                      f"-{s['savings_pct']:.0f}%) at {s['store']}")

    # Save plan
    plan_file = Path(__file__).parent / "data" / "current_plan.json"
    with open(plan_file, "w") as f:
        json.dump({
            "generated_at": datetime.now().isoformat(),
            "forecast": forecast,
            "plan_items": plan_items,
            "prices_used": len(prices),
        }, f, indent=2, default=str)

    print(f"\nPlan saved to {plan_file}")
    return forecast


# ─── CLI ─────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Harmony: Grocery Automation Agent")
    parser.add_argument("action", nargs="?", default="interactive",
                        choices=["login", "scrape-orders", "scrape-prices",
                                 "forecast", "plan", "interactive", "verify"])
    parser.add_argument("site", nargs="?", default=None,
                        help="Site name for login action")
    parser.add_argument("--zip", default=LOCAL_ZIP, help="Zip code for price scraping")

    args = parser.parse_args()

    if args.action == "login":
        if not args.site:
            print(f"Usage: python3 main.py login <site>")
            print(f"  Sites: {', '.join(SITES)}")
            return
        interactive_login(args.site)

    elif args.action == "scrape-orders":
        scrape_all_orders()

    elif args.action == "scrape-prices":
        site_list = [args.site] if args.site else None
        scrape_all_prices(zip_code=args.zip, stores=site_list)

    elif args.action == "forecast":
        run_forecast()

    elif args.action == "plan":
        generate_plan()

    elif args.action == "interactive":
        print("=== Interactive Grocery Automation Setup ===\n")
        print("This will walk you through logging into each site.")
        print("Browser will open on your desktop — complete 2FA/captcha there.\n")

        for site in SITES:
            print(f"\n--- {site.upper()} ---")
            resp = input(f"  Login to {site}? (y/n): ").strip().lower()
            if resp == 'y':
                interactive_login(site)
            print()

        print("\n--- Initial Scrape ---")
        resp = input("  Scrape orders now? (y/n): ").strip().lower()
        if resp == 'y':
            scrape_all_orders()

        resp = input("  Scrape prices now? (y/n): ").strip().lower()
        if resp == 'y':
            scrape_all_prices()

        resp = input("  Generate forecast? (y/n): ").strip().lower()
        if resp == 'y':
            generate_plan()

        print("\n✅ Setup complete!")
        print(f"  Database: {DB_PATH}")
        print(f"  Data: {Path(__file__).parent / 'data'}")
        print(f"  Profiles: {Path(__file__).parent / 'profiles'}")

    elif args.action == "verify":
        verify_setup()

    else:
        parser.print_help()


def verify_setup():
    """Verify that the system is properly configured."""
    print("=== System Verification ===\n")

    # Python version
    print(f"✅ Python {sys.version}")

    # Check imports
    try:
        import playwright
        print(f"✅ Playwright installed (version check unavailable)")
    except ImportError:
        print("❌ Playwright not installed: pip install playwright")

    try:
        from sqlalchemy import create_engine
        print("✅ SQLAlchemy available")
    except ImportError:
        print("❌ SQLAlchemy not installed")

    # Check display
    from core import detect_display
    env = detect_display()
    if env.get("DISPLAY") or env.get("WAYLAND_DISPLAY"):
        print(f"✅ Display available: DISPLAY={env.get('DISPLAY','')} WAYLAND={env.get('WAYLAND_DISPLAY','')}")
    else:
        print("❌ No display detected — cannot run headed browser")

    # Check Chromium
    import shutil
    chromium = shutil.which("chromium") or shutil.which("chromium-browser") or shutil.which("google-chrome")
    if chromium:
        print(f"✅ Chromium found: {chromium}")
    else:
        print("❌ Chromium not found in PATH")

    # Check directories
    for d in ["profiles", "data", "scrapers", "core", "storage", "models", "planners"]:
        p = Path(__file__).parent / d
        if p.exists():
            print(f"✅ {d}/ exists")
        else:
            print(f"❌ {d}/ missing")

    # Check display connection
    try:
        from subprocess import run
        display_env = detect_display()
        result = run(
            ["xdpyinfo", "-display", display_env.get("DISPLAY", ":1")],
            capture_output=True, text=True, timeout=5,
            env={**os.environ, **display_env},
        )
        if result.returncode == 0:
            screen_line = [l for l in result.stdout.split('\n') if 'dimensions' in l]
            print(f"✅ X11 display connected: {screen_line[0].strip() if screen_line else 'ok'}")
        else:
            print(f"⚠️  xdpyinfo failed: {result.stderr.strip()}")
    except Exception as e:
        print(f"⚠️  Display check: {e}")

    print("\n=== System Ready ===")


if __name__ == "__main__":
    main()
