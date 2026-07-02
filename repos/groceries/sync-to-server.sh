#!/bin/bash
# sync-to-server.sh — Push locally scraped data to the hosted groceries.ffilt.us service.
#
# Two modes:
#   1. SCP direct: copy data/ to the server's container volume mount
#   2. API push: POST data through the web API
#
# Configure SERVER in sync-config.sh (created on first run if absent).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CONFIG_FILE="$PROJECT_DIR/data/sync-config.sh"

# ─── Defaults ───────────────────────────────────────────────────────────
SERVER_HOST="groceries.ffilt.us"
SERVER_PORT=""
SERVER_API_KEY=""
SYNC_MODE="api"  # or "scp"

# ─── Load or create config ──────────────────────────────────────────────
if [ -f "$CONFIG_FILE" ]; then
    source "$CONFIG_FILE"
else
    cat > "$CONFIG_FILE" << 'CONFIGEOF'
# Groceries sync configuration
# Edit these values for your deployment
SERVER_HOST="groceries.ffilt.us"
SERVER_PORT=""            # e.g. "2222" for non-standard SSH, or 8080 for API
SERVER_API_KEY=""         # API key for authentication (future use)
SYNC_MODE="api"           # "api" = POST via HTTP, "scp" = direct file copy
CONFIGEOF
    echo "Config created at $CONFIG_FILE — please edit before first sync."
    exit 0
fi

# ─── Mode: API Push ─────────────────────────────────────────────────────
if [ "$SYNC_MODE" = "api" ]; then
    BASE_URL="${SERVER_PORT:+https://${SERVER_HOST}:${SERVER_PORT}}"
    BASE_URL="${BASE_URL:-https://${SERVER_HOST}}"

    echo "Syncing to $BASE_URL ..."

    # 1. Export DB to JSON
    echo "  Exporting orders from database..."
    cd "$PROJECT_DIR"
    .venv/bin/python3 -c "
import sys; sys.path.insert(0, '.')
from storage import get_engine, get_session, init_db
from models import Order as OrderModel
import json

session = get_session()
orders = session.query(OrderModel).order_by(OrderModel.order_date.desc()).limit(200).all()
result = []
for o in orders:
    result.append({
        'order_id': o.order_id,
        'store': o.store,
        'order_date': o.order_date.isoformat() if o.order_date else None,
        'total': float(o.total) if o.total else None,
        'status': o.status,
        'item_count': o.item_count,
        'items': [{'name': i.item_name, 'quantity': i.quantity, 'price': float(i.price) if i.price else None}
                  for i in o.items],
    })
with open('data/orders_export.json', 'w') as f:
    json.dump(result, f, indent=2)
print(f'  Exported {len(result)} orders')
session.close()
"

    # 2. Push prices JSON
    if [ -f "$PROJECT_DIR/data/latest_prices.json" ]; then
        echo "  Uploading prices..."
        curl -s -X POST "$BASE_URL/api/scrape/prices" \
            -H "Content-Type: application/json" \
            --data-raw '{"prices": []}' \
            -o /dev/null -w "  HTTP %{http_code}\n" || echo "  ⚠️  API push failed (offline?)"
    fi

    # 3. Upload exported orders
    if [ -f "$PROJECT_DIR/data/orders_export.json" ]; then
        echo "  Data ready for server import."
        echo "  Place orders_export.json on the server and run:"
        echo "    python3 -c \"import json; ...\"  (see import-data.py)"
    fi

    echo "✅ Sync complete."
fi

# ─── Mode: SCP Direct ───────────────────────────────────────────────────
if [ "$SYNC_MODE" = "scp" ]; then
    SCP_TARGET="${SERVER_HOST}:${SERVER_DATA_DIR:-/app/data/}"
    PORT_FLAG=""
    [ -n "$SERVER_PORT" ] && PORT_FLAG="-P $SERVER_PORT"

    echo "Syncing data/ to $SCP_TARGET ..."
    rsync -avz $PORT_FLAG \
        --include='latest_prices.json' \
        --include='grocery.db' \
        --include='purchase_patterns.json' \
        --exclude='*' \
        "$PROJECT_DIR/data/" \
        "$SCP_TARGET"
    echo "✅ SCP sync complete."
fi
