#!/usr/bin/env python3
"""
Import exported order data into the hosted groceries.ffilt.us database.
Run this on the server after uploading orders_export.json.
"""
import sys
import json
import os
from pathlib import Path

# Add project to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from storage import get_engine, get_session, init_db, store_order

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
EXPORT_FILE = DATA_DIR / "orders_export.json"

if not EXPORT_FILE.exists():
    print(f"No export file found at {EXPORT_FILE}")
    print("Upload orders_export.json to the server first.")
    sys.exit(1)

print(f"Importing orders from {EXPORT_FILE}...")

engine = get_engine()
init_db(engine)
session = get_session(engine)

with open(EXPORT_FILE) as f:
    orders = json.load(f)

count = 0
for order_data in orders:
    try:
        store_order(session, order_data.get("store", "unknown"), order_data)
        count += 1
    except Exception as e:
        print(f"  Error importing order {order_data.get('order_id')}: {e}")

session.commit()
session.close()

print(f"✅ Imported {count} orders.")
print(f"   Source: {EXPORT_FILE}")
