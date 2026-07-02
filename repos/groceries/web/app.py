"""
Groceries FFILT.US — FastAPI application.

Provides:
- GET / — Dashboard overview
- GET /api/orders — Order history
- GET /api/prices — Current prices with best-price comparison
- GET /api/forecast — Outage forecasting
- GET /api/plan — Shopping plan
- POST /api/scrape/orders — Trigger order scrape
- POST /api/scrape/prices — Trigger price scrape

Designed to run as an agent-stack service on groceries.ffilt.us
"""
import os
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# ─── Setup ───────────────────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("web")

app = FastAPI(
    title="Groceries FFILT.US",
    description="Grocery automation — order history, price comparison, outage forecasting",
    version="0.1.0",
)

PROJECT_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_DIR / "data"
TEMPLATES_DIR = Path(__file__).resolve().parent / "templates"


# ─── Pydantic Models ─────────────────────────────────────────────────────

class ScrapeResponse(BaseModel):
    status: str
    orders_found: Optional[int] = None
    prices_found: Optional[int] = None
    message: str = ""


# ─── Helper Functions ────────────────────────────────────────────────────

def load_json(filename: str) -> list:
    """Load a JSON file from the data directory."""
    path = DATA_DIR / filename
    if not path.exists():
        return []
    try:
        with open(path) as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return []


def get_db_session():
    """Get database session for lazy loading."""
    from storage import get_engine, get_session, init_db
    engine = get_engine()
    init_db(engine)
    return get_session(engine)


# ─── Routes ──────────────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def dashboard():
    """Main dashboard — send static HTML, JS fetches data from /api."""
    html = """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Groceries FFILT.US</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
               background: #0f1117; color: #e1e4e8; line-height: 1.6; }
        .container { max-width: 1200px; margin: 0 auto; padding: 2rem; }
        header { border-bottom: 1px solid #30363d; padding-bottom: 1rem; margin-bottom: 2rem; }
        h1 { font-size: 1.8rem; font-weight: 600; color: #f0f6fc; }
        h1 small { font-size: 1rem; color: #8b949e; font-weight: 400; }
        .subtitle { color: #8b949e; font-size: 0.9rem; }
        .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
        .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 1.5rem; }
        .card h3 { font-size: 0.8rem; text-transform: uppercase; color: #8b949e; margin-bottom: 0.5rem; }
        .card .number { font-size: 2rem; font-weight: 700; color: #58a6ff; }
        .card .label { font-size: 0.85rem; color: #8b949e; }
        .section { margin-bottom: 2rem; }
        .section h2 { font-size: 1.2rem; margin-bottom: 1rem; color: #f0f6fc; border-bottom: 1px solid #21262d; padding-bottom: 0.5rem; }
        table { width: 100%; border-collapse: collapse; }
        th { text-align: left; padding: 0.5rem; color: #8b949e; font-size: 0.8rem; text-transform: uppercase; border-bottom: 1px solid #21262d; }
        td { padding: 0.5rem; border-bottom: 1px solid #21262d; font-size: 0.9rem; }
        .store-badge { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 12px; font-size: 0.75rem; font-weight: 500; }
        .badge-walmart { background: #0071dc22; color: #68b5ff; border: 1px solid #0071dc44; }
        .badge-amazon { background: #ff990022; color: #ffbd59; border: 1px solid #ff990044; }
        .badge-kroger { background: #005b2e22; color: #6cc04a; border: 1px solid #005b2e44; }
        .badge-samsclub { background: #002f6c22; color: #007bff; border: 1px solid #002f6c44; }
        .badge-aldi { background: #003e7022; color: #00a1de; border: 1px solid #003e7044; }
        .badge-overdue { background: #da363322; color: #ff7b72; }
        .badge-upcoming { background: #d2992222; color: #d29922; }
        .price { font-family: 'SF Mono', 'Fira Code', monospace; color: #7ee787; }
        .actions { display: flex; gap: 1rem; margin: 1rem 0; flex-wrap: wrap; }
        .btn { display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.6rem 1.2rem;
                border: 1px solid #30363d; border-radius: 8px; background: #21262d; color: #e1e4e8;
                text-decoration: none; font-size: 0.9rem; cursor: pointer; }
        .btn:hover { background: #30363d; }
        .btn-primary { background: #238636; border-color: #2ea043; }
        .btn-primary:hover { background: #2ea043; }
        footer { border-top: 1px solid #30363d; padding-top: 1rem; margin-top: 2rem; color: #8b949e; font-size: 0.8rem; }
        .empty-state { color: #8b949e; padding: 1rem 0; }
        .badge { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 12px; font-size: 0.75rem; }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>Groceries <small>FFILT.US</small></h1>
            <div class="subtitle">Order history &middot; Price comparison &middot; Outage forecasting</div>
            <div class="actions">
                <a href="/api/orders" class="btn">Orders API</a>
                <a href="/api/prices" class="btn">Prices API</a>
                <a href="/api/forecast" class="btn">Forecast API</a>
                <a href="/api/plan" class="btn">Plan API</a>
            </div>
        </header>

        <div class="cards">
            <div class="card">
                <h3>Orders Tracked</h3>
                <div class="number" id="stat-orders">--</div>
            </div>
            <div class="card">
                <h3>Prices Scraped</h3>
                <div class="number" id="stat-prices">--</div>
                <div class="label">across <span id="stat-stores">--</span> stores</div>
            </div>
            <div class="card">
                <h3>Purchase Patterns</h3>
                <div class="number" id="stat-patterns">--</div>
            </div>
            <div class="card">
                <h3>Overdue Items</h3>
                <div class="number" id="stat-overdue">--</div>
            </div>
        </div>

        <div class="section">
            <h2>Forecast</h2>
            <div id="forecast-content"><p class="empty-state">Loading...</p></div>
        </div>

        <div class="section">
            <h2>Recent Orders</h2>
            <div id="orders-content"><p class="empty-state">Loading...</p></div>
        </div>

        <footer>
            <p>Data refreshed via Hermes Agent cron jobs</p>
        </footer>
    </div>

    <script>
    async function api(url) {
        const r = await fetch(url);
        return r.json();
    }

    async function init() {
        // Stats
        const orders = await api('/api/orders?limit=1');
        const prices = await api('/api/prices?limit=1');
        const forecast = await api('/api/forecast');

        document.getElementById('stat-orders').textContent = orders.length + (orders.length >= 50 ? '+' : '');
        document.getElementById('stat-prices').textContent = prices.length + (prices.length >= 50 ? '+' : '');
        document.getElementById('stat-patterns').textContent = (forecast.total_items || 0);
        document.getElementById('stat-overdue').textContent = (forecast.item_count?.overdue || 0);

        // Store count from prices
        try {
            const allPrices = await api('/api/prices?limit=999');
            const stores = new Set(allPrices.map(p => p.store));
            document.getElementById('stat-stores').textContent = stores.size;
        } catch(e) {}

        // Forecast table
        const fcEl = document.getElementById('forecast-content');
        const items = [...(forecast.overdue || []), ...(forecast.coming_soon || [])];
        if (items.length === 0) {
            fcEl.innerHTML = '<p class="empty-state">Not enough purchase data for forecasting yet.</p>';
        } else {
            let html = '<table><tr><th>Item</th><th>Store</th><th>Status</th><th>Days</th></tr>';
            for (const item of items.slice(0, 10)) {
                const cls = item.days_until_predicted < 0 ? 'badge-overdue' : 'badge-upcoming';
                const label = item.days_until_predicted < 0 ? 'OVERDUE' : 'coming soon';
                html += '<tr><td>' + item.item_name + '</td><td>' + item.store + '</td>';
                html += '<td><span class="badge ' + cls + '">' + label + '</span></td>';
                html += '<td>' + item.days_until_predicted + 'd</td></tr>';
            }
            html += '</table>';
            fcEl.innerHTML = html;
        }

        // Orders table
        const ordEl = document.getElementById('orders-content');
        if (orders.length === 0) {
            ordEl.innerHTML = '<p class="empty-state">No orders scraped yet.</p>';
        } else {
            const allOrders = await api('/api/orders?limit=15');
            let html = '<table><tr><th>Store</th><th>Order ID</th><th>Date</th><th>Items</th><th>Total</th></tr>';
            for (const o of allOrders) {
                html += '<tr><td><span class="store-badge badge-' + o.store + '">' + o.store + '</span></td>';
                html += '<td>' + (o.order_id || '&mdash;') + '</td>';
                html += '<td>' + (o.order_date ? o.order_date.slice(0,10) : '&mdash;') + '</td>';
                html += '<td>' + (o.item_count || 0) + '</td>';
                html += '<td class="price">' + (o.total ? '$' + parseFloat(o.total).toFixed(2) : '&mdash;') + '</td></tr>';
            }
            html += '</table>';
            ordEl.innerHTML = html;
        }
    }
    init();
    </script>
</body>
</html>"""
    return HTMLResponse(content=html)


@app.get("/api/orders")
async def get_orders(store: Optional[str] = None, limit: int = Query(default=50, le=200)):
    """Get order history, optionally filtered by store."""
    session = get_db_session()
    from models import Order as OrderModel
    query = session.query(OrderModel)
    if store:
        query = query.filter(OrderModel.store == store)
    orders = query.order_by(OrderModel.order_date.desc()).limit(limit).all()

    result = []
    for o in orders:
        result.append({
            "order_id": o.order_id,
            "store": o.store,
            "order_date": o.order_date.isoformat() if o.order_date else None,
            "total": float(o.total) if o.total else None,
            "status": o.status,
            "item_count": o.item_count,
            "items": [{"name": i.item_name, "quantity": i.quantity, "price": float(i.price) if i.price else None}
                      for i in o.items],
        })
    session.close()
    return JSONResponse(content=result)


@app.get("/api/prices")
async def get_prices(store: Optional[str] = None, search: Optional[str] = None, limit: int = 50):
    """Get current price data, with optional filter and search."""
    prices = load_json("latest_prices.json")
    if store:
        prices = [p for p in prices if p.get("store") == store]
    if search:
        search_lower = search.lower()
        prices = [p for p in prices if search_lower in p.get("name", "").lower()]
    return JSONResponse(content=prices[:limit])


@app.get("/api/forecast")
async def get_forecast(days: int = 14):
    """Get outage forecast for the next N days."""
    from planners.forecaster import build_purchase_patterns, shopping_list_summary

    session = get_db_session()
    from models import Order as OrderModel
    db_orders = session.query(OrderModel).all()
    orders = []
    for o in db_orders:
        orders.append({
            "order_id": o.order_id,
            "store": o.store,
            "order_date": o.order_date.isoformat() if o.order_date else None,
            "items": [{"name": i.item_name, "quantity": i.quantity} for i in o.items],
        })
    session.close()

    patterns = build_purchase_patterns(orders)
    summary = shopping_list_summary(patterns, days_ahead=days)
    return JSONResponse(content=summary)


@app.get("/api/plan")
async def get_plan(days: int = 7):
    """Generate a shopping plan combining forecast + best prices."""
    prices = load_json("latest_prices.json")

    session = get_db_session()
    from models import Order as OrderModel
    db_orders = session.query(OrderModel).all()
    orders = []
    for o in db_orders:
        orders.append({
            "order_id": o.order_id,
            "store": o.store,
            "order_date": o.order_date.isoformat() if o.order_date else None,
            "items": [{"name": i.item_name, "quantity": i.quantity} for i in o.items],
        })
    session.close()

    from planners.forecaster import build_purchase_patterns, shopping_list_summary
    patterns = build_purchase_patterns(orders)
    summary = shopping_list_summary(patterns, days_ahead=days)

    from planners.price_optimizer import best_price_across_stores
    plan_items = []
    for item in summary.get("overdue", []) + summary.get("coming_soon", []):
        bp = best_price_across_stores(item["item_name"], prices) if prices else None
        plan_items.append({
            "item": item["item_name"],
            "store": item["store"],
            "days_until_predicted": item["days_until_predicted"],
            "best_store": bp["store"] if bp else None,
            "best_price": bp["price"] if bp else None,
            "typical_quantity": item.get("typical_quantity", 1),
        })

    return JSONResponse(content={
        "forecast": summary,
        "plan_items": plan_items,
        "store_recommendations": summary.get("suggested_stores", []),
    })


@app.post("/api/scrape/orders", response_model=ScrapeResponse)
async def trigger_order_scrape():
    """
    Trigger an order scrape across all authenticated stores.
    Note: This requires the display to be available.
    """
    try:
        from main import scrape_all_orders
        orders = scrape_all_orders()
        return ScrapeResponse(
            status="success",
            orders_found=len(orders),
            message=f"Scraped {len(orders)} orders"
        )
    except Exception as e:
        logger.error(f"Order scrape failed: {e}")
        return ScrapeResponse(status="error", message=str(e))


@app.post("/api/scrape/prices", response_model=ScrapeResponse)
async def trigger_price_scrape(zip_code: str = "43147"):
    """Trigger a price scrape."""
    try:
        from main import scrape_all_prices
        items = scrape_all_prices(zip_code=zip_code)
        return ScrapeResponse(
            status="success",
            prices_found=len(items),
            message=f"Scraped {len(items)} prices near {zip_code}"
        )
    except Exception as e:
        logger.error(f"Price scrape failed: {e}")
        return ScrapeResponse(status="error", message=str(e))


@app.get("/api/stores")
async def get_stores():
    """List all stores we track."""
    return JSONResponse(content=[
        {"name": "Walmart", "slug": "walmart", "has_orders": True, "has_prices": True},
        {"name": "Sam's Club", "slug": "samsclub", "has_orders": True, "has_prices": True},
        {"name": "Amazon", "slug": "amazon", "has_orders": True, "has_prices": True},
        {"name": "Kroger", "slug": "kroger", "has_orders": True, "has_prices": True},
        {"name": "ALDI", "slug": "aldi", "has_orders": False, "has_prices": True},
    ])


@app.get("/health")
async def health():
    return {"status": "ok", "db_path": str(DATA_DIR / "grocery.db")}
