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
        .tabs { display: flex; gap: 0; margin-bottom: 1.5rem; border-bottom: 1px solid #30363d; }
        .tab { padding: 0.6rem 1.2rem; cursor: pointer; border: none; background: none; color: #8b949e; font-size: 0.9rem; border-bottom: 2px solid transparent; transition: all 0.2s; }
        .tab:hover { color: #e1e4e8; }
        .tab.active { color: #58a6ff; border-bottom-color: #58a6ff; }
        .tab-content { display: none; }
        .tab-content.active { display: block; }
        .method-badge { display: inline-block; padding: 0.1rem 0.4rem; border-radius: 8px; font-size: 0.7rem; font-weight: 500; }
        .method-pickup { background: #d2992222; color: #d29922; border: 1px solid #d2992244; }
        .method-delivery { background: #58a6ff22; color: #58a6ff; border: 1px solid #58a6ff44; }
        .method-shipped { background: #7ee78722; color: #7ee787; border: 1px solid #7ee78744; }
        .method-in-store { background: #bc8cff22; color: #bc8cff; border: 1px solid #bc8cff44; }
        .method-fuel { background: #ff7b7222; color: #ff7b72; border: 1px solid #ff7b7244; }
        .order-row { cursor: pointer; }
        .order-row:hover { background: #1c2128; }
        .order-items { display: none; }
        .order-items.open { display: table-row; }
        .order-items td { padding: 0.5rem 1rem 0.5rem 3rem; background: #161b22; font-size: 0.85rem; }
        .item-dot { color: #8b949e; margin-right: 0.5rem; }
        .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 0.75rem; margin-bottom: 1.5rem; }
        .summary-item { background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 0.8rem; text-align: center; }
        .summary-item .num { font-size: 1.3rem; font-weight: 600; color: #f0f6fc; }
        .summary-item .lbl { font-size: 0.7rem; color: #8b949e; text-transform: uppercase; }
        .merchant-stats { display: flex; gap: 0.75rem; flex-wrap: wrap; margin-bottom: 1rem; }
        .merchant-stat { display: flex; align-items: center; gap: 0.5rem; padding: 0.4rem 0.8rem; background: #161b22; border-radius: 8px; border: 1px solid #30363d; font-size: 0.85rem; }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>Groceries <small>FFILT.US</small></h1>
            <div class="subtitle">Order history &middot; Price comparison &middot; Outage forecasting</div>
            <div class="actions">
            <a href="/api/orders/unified" class="btn">Unified Orders API</a>
            <a href="/api/orders" class="btn">Orders by Store</a>
            <a href="/api/prices" class="btn">Prices API</a>
            <a href="/api/plan" class="btn">Plan API</a>
            </div>
        </header>

        <div style="display:flex; gap:1.5rem; flex-wrap:wrap; margin-bottom:1.5rem; padding:0.75rem 0; border-bottom:1px solid #30363d; font-size:0.85rem; color:#8b949e">
            <span>📊 <strong id="stat-summary" style="color:#f0f6fc">Loading...</strong></span>
            <span>🏪 <span id="stat-merchants">--</span> merchants</span>
            <span>💰 <span id="stat-total">--</span> total</span>
        </div>

        <div class="tabs">
            <button class="tab active" onclick="switchTab('summary')">📊 Summary</button>
            <button class="tab" onclick="switchTab('orders')">🛒 Unified Orders</button>
            <button class="tab" onclick="switchTab('forecast')">📈 Forecast</button>
        </div>

        <!-- Tab: Summary -->
        <div id="tab-summary" class="tab-content active">
            <div class="summary-grid" id="summary-grid">
                <div class="summary-item"><div class="num" id="sum-total-orders">--</div><div class="lbl">Total Orders</div></div>
                <div class="summary-item"><div class="num" id="sum-total-spent">--</div><div class="lbl">Total Spent</div></div>
                <div class="summary-item"><div class="num" id="sum-total-items">--</div><div class="lbl">Total Items</div></div>
                <div class="summary-item"><div class="num" id="sum-merchants">--</div><div class="lbl">Merchants</div></div>
            </div>
            <div id="merchant-stats"></div>
            <div id="recent-orders-preview"></div>
        </div>

        <!-- Tab: Unified Orders -->
        <div id="tab-orders" class="tab-content">
            <div id="unified-orders-content"><p class="empty-state">Loading...</p></div>
        </div>

        <!-- Tab: Forecast -->
        <div id="tab-forecast" class="tab-content">
            <div id="forecast-content"><p class="empty-state">Loading...</p></div>
        </div>

        <footer>
            <p>Groceries FFILT.US &middot; Automated order tracking &amp; price comparison</p>
        </footer>
    </div>

    <script>
    let unifiedData = null;
    
    async function api(url) {
        const r = await fetch(url);
        return r.json();
    }

    function switchTab(name) {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        document.querySelector(`.tab[onclick="switchTab('${name}')"]`).classList.add('active');
        document.getElementById(`tab-${name}`).classList.add('active');
    }

    function methodClass(method) {
        const m = (method || '').toLowerCase().replace(/[^a-z]/g, '-');
        return `method-badge method-${m}`;
    }

    function escapeHtml(s) {
        if (!s) return '';
        return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    async function init() {
        // Fetch unified orders
        try {
            unifiedData = await api('/api/orders/unified?limit=500');
        } catch(e) {
            document.getElementById('unified-orders-content').innerHTML = 
                '<p class="empty-state">Failed to load orders: ' + e.message + '</p>';
            return;
        }

        const { orders, meta, merchants } = unifiedData;

        // ── Header Stats ──
        document.getElementById('stat-summary').textContent = `${meta.total_orders} orders, ${meta.total_items} items`;
        document.getElementById('stat-merchants').textContent = Object.keys(meta.merchant_stats).length;
        document.getElementById('stat-total').textContent = `$${meta.total_spent.toLocaleString()}`;

        // ── Summary Tab ──
        document.getElementById('sum-total-orders').textContent = meta.total_orders;
        document.getElementById('sum-total-spent').textContent = '$' + meta.total_spent.toLocaleString();
        document.getElementById('sum-total-items').textContent = meta.total_items.toLocaleString();
        const activeMerchants = Object.keys(meta.merchant_stats).length;
        document.getElementById('sum-merchants').textContent = activeMerchants;

        // Merchant stats
        let msHtml = '<div class="merchant-stats">';
        for (const [slug, st] of Object.entries(meta.merchant_stats)) {
            const m = merchants[slug] || { name: slug, color: '#888', icon: '📦' };
            msHtml += `<div class="merchant-stat">
                <span>${m.icon}</span>
                <span><strong>${m.name}</strong></span>
                <span>${st.count} orders</span>
                <span style="color:${m.color}">$${st.total.toFixed(2)}</span>
                <span style="color:#8b949e">${st.items} items</span>
            </div>`;
        }
        msHtml += '</div>';
        document.getElementById('merchant-stats').innerHTML = msHtml;

        // Recent preview (last 5)
        let previewHtml = '<h2 style="font-size:1rem;margin-bottom:0.75rem;color:#f0f6fc">Recent Orders</h2>';
        if (orders.length === 0) {
            previewHtml += '<p class="empty-state">No orders yet.</p>';
        } else {
            previewHtml += '<table><tr><th>Date</th><th>Merchant</th><th>Total</th><th>Items</th><th>Method</th></tr>';
            for (const o of orders.slice(0, 5)) {
                previewHtml += `<tr>
                    <td>${o.order_date ? o.order_date.slice(0,10) : '--'}</td>
                    <td><span class="store-badge badge-${o.store}">${o.merchant_icon} ${o.merchant_name}</span></td>
                    <td class="price">$${o.total.toFixed(2)}</td>
                    <td>${o.item_count}</td>
                    <td><span class="${methodClass(o.method)}">${o.method}</span></td>
                </tr>`;
            }
            previewHtml += '</table>';
        }
        document.getElementById('recent-orders-preview').innerHTML = previewHtml;

        // ── Unified Orders Tab ──
        if (orders.length === 0) {
            document.getElementById('unified-orders-content').innerHTML = 
                '<p class="empty-state">No orders scraped yet. Use the scrape buttons to fetch orders.</p>';
        } else {
            let html = '<div style="margin-bottom:0.75rem;color:#8b949e;font-size:0.85rem">Showing ' + orders.length + ' orders, sorted newest first</div>';
            html += '<table><tr><th>Date</th><th>Merchant</th><th>Order ID</th><th>Items</th><th>Total</th><th>Method</th></tr>';
            for (const o of orders) {
                const dateStr = o.order_date ? o.order_date.slice(0,10) : '--';
                const hasItems = o.items && o.items.length > 0;
                html += `<tr class="order-row" onclick="toggleItems('${escapeHtml(o.order_id)}')">
                    <td>${dateStr}</td>
                    <td><span class="store-badge badge-${o.store}">${o.merchant_icon} ${o.merchant_name}</span></td>
                    <td style="font-family:monospace;font-size:0.8rem;color:#8b949e">${escapeHtml(o.order_id) || '--'}</td>
                    <td>${o.item_count}</td>
                    <td class="price">$${o.total.toFixed(2)}</td>
                    <td><span class="${methodClass(o.method)}">${o.method}</span></td>
                </tr>`;
                if (hasItems) {
                    html += `<tr class="order-items" id="items-${escapeHtml(o.order_id)}"><td colspan="6">`;
                    for (const item of o.items) {
                        const itemPrice = item.price ? '$' + item.price.toFixed(2) : '';
                        html += `<div><span class="item-dot">•</span>${escapeHtml(item.name)} ${item.quantity > 1 ? '×' + item.quantity : ''} ${itemPrice ? '— ' + itemPrice : ''}</div>`;
                    }
                    html += '</td></tr>';
                }
            }
            html += '</table>';
            html += '<div style="margin-top:1rem;text-align:center"><a href="/api/orders/unified" class="btn">View Full API Response</a></div>';
            document.getElementById('unified-orders-content').innerHTML = html;
        }

        // ── Forecast Tab ──
        try {
            const forecast = await api('/api/forecast');
            const fcEl = document.getElementById('forecast-content');
            const items = [...(forecast.overdue || []), ...(forecast.coming_soon || [])];
            if (items.length === 0) {
                fcEl.innerHTML = '<p class="empty-state">Not enough purchase data for forecasting yet.</p>';
            } else {
                let html = '<div style="margin-bottom:1rem">';
                html += '<div class="summary-grid">';
                html += '<div class="summary-item"><div class="num">' + (forecast.item_count?.overdue || 0) + '</div><div class="lbl">Overdue</div></div>';
                html += '<div class="summary-item"><div class="num">' + (forecast.item_count?.upcoming || 0) + '</div><div class="lbl">Upcoming</div></div>';
                html += '<div class="summary-item"><div class="num">' + (forecast.total_items || 0) + '</div><div class="lbl">Tracked Items</div></div>';
                html += '</div></div>';
                html += '<table><tr><th>Item</th><th>Store</th><th>Status</th><th>Days</th></tr>';
                for (const item of items.slice(0, 20)) {
                    const cls = item.days_until_predicted < 0 ? 'badge-overdue' : 'badge-upcoming';
                    const label = item.days_until_predicted < 0 ? 'OVERDUE' : 'coming soon';
                    html += `<tr><td>${escapeHtml(item.item_name)}</td><td>${item.store}</td>`;
                    html += `<td><span class="badge ${cls}">${label}</span></td>`;
                    html += `<td>${item.days_until_predicted}d</td></tr>`;
                }
                html += '</table>';
                fcEl.innerHTML = html;
            }
        } catch(e) {
            document.getElementById('forecast-content').innerHTML = '<p class="empty-state">Forecast unavailable.</p>';
        }
    }

    function toggleItems(orderId) {
        const el = document.getElementById('items-' + orderId.replace(/[^a-zA-Z0-9-_]/g, '_'));
        if (el) {
            el.classList.toggle('open');
        }
    }

    init();
    </script>
</body>
</html>"""
    return HTMLResponse(content=html)


@app.get("/api/orders/unified")
async def get_unified_orders(limit: int = Query(default=100, le=500), offset: int = Query(default=0, ge=0)):
    """Get all orders from all merchants, unified and chronological.

    Returns orders with merchant info, cost, items, and fulfillment method.
    """
    session = get_db_session()
    from models import Order as OrderModel
    orders = (
        session.query(OrderModel)
        .order_by(OrderModel.order_date.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    # Merchant display config
    MERCHANT_META = {
        "amazon": {"name": "Amazon", "color": "#ff9900", "icon": "🛒"},
        "walmart": {"name": "Walmart", "color": "#0071dc", "icon": "🏪"},
        "kroger": {"name": "Kroger", "color": "#6cc04a", "icon": "🥬"},
        "samsclub": {"name": "Sam's Club", "color": "#007bff", "icon": "🏬"},
        "aldi": {"name": "ALDI", "color": "#00a1de", "icon": "🏷️"},
    }

    # Stats
    total_spent = 0.0
    total_items = 0
    merchant_stats = {}

    result = []
    for o in orders:
        store = o.store.lower()
        meta = MERCHANT_META.get(store, {"name": store, "color": "#888", "icon": "📦"})
        total = float(o.total) if o.total else 0
        item_count = o.item_count or len(o.items) if o.items else 0
        total_spent += total
        total_items += item_count

        if store not in merchant_stats:
            merchant_stats[store] = {"count": 0, "total": 0.0, "items": 0}
        merchant_stats[store]["count"] += 1
        merchant_stats[store]["total"] += total
        merchant_stats[store]["items"] += item_count

        # Determine fulfillment method
        status = (o.status or "").lower()
        if any(w in status for w in ["pickup", "curbside"]):
            method = "Pickup"
        elif any(w in status for w in ["delivery", "delivered", "shipped"]):
            method = "Delivery"
        elif any(w in status for w in ["fuel"]):
            method = "Fuel"
        elif any(w in status for w in ["in-store", "instore"]):
            method = "In-Store"
        elif store == "amazon":
            method = "Shipped"
        elif store == "kroger" and "fuel" in (o.raw_data or {}).get("type", "").lower():
            method = "Fuel"
        else:
            method = status.capitalize() if status else "N/A"

        result.append({
            "order_id": o.order_id,
            "store": store,
            "merchant_name": meta["name"],
            "merchant_color": meta["color"],
            "merchant_icon": meta["icon"],
            "order_date": o.order_date.isoformat() if o.order_date else None,
            "total": total,
            "currency": o.currency or "USD",
            "method": method,
            "status": o.status,
            "item_count": item_count,
            "shipping_address": o.shipping_address,
            "items": [
                {
                    "name": i.item_name,
                    "quantity": i.quantity,
                    "price": float(i.price) if i.price else None,
                    "sku": i.sku,
                }
                for i in (o.items or [])
            ],
        })

    session.close()

    return JSONResponse(content={
        "orders": result,
        "meta": {
            "total_orders": len(result),
            "total_spent": round(total_spent, 2),
            "total_items": total_items,
            "merchant_stats": merchant_stats,
            "offset": offset,
            "limit": limit,
        },
        "merchants": MERCHANT_META,
    })

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
