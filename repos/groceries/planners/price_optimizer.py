"""
Price analysis module — finds the best prices across stores,
identifies sales, and tracks price trends.
"""
import re
import logging
from datetime import datetime, timedelta
from collections import defaultdict
from typing import Optional

from planners import similarity, get_canonical_key, normalize_product_name

logger = logging.getLogger(__name__)


def best_price_across_stores(
    item_name: str,
    price_data: list[dict],
    store_key: str = "store",
    name_key: str = "name",
    price_key: str = "price",
) -> Optional[dict]:
    """
    Find the best price for an item across all stores.
    Uses fuzzy matching to handle different product names.

    Args:
        item_name: The item to search for
        price_data: List of {store, name, price, ...} dicts

    Returns:
        {store, name, price, unit_price, similarity_score} or None
    """
    candidates = []
    canonical_query = normalize_product_name(item_name)

    for entry in price_data:
        entry_name = entry.get(name_key, "")
        score = similarity(item_name, entry_name)

        if score >= 0.4:
            candidates.append({
                "store": entry.get(store_key),
                "name": entry_name,
                "price": entry.get(price_key),
                "unit_price": entry.get("unit_price"),
                "size": entry.get("size"),
                "similarity": round(score, 3),
            })

    if not candidates:
        return None

    # Sort by price ascending (best = cheapest)
    candidates.sort(key=lambda x: (x["price"] is None, x["price"] or float("inf")))

    return candidates[0]


def price_summary(
    item_name: str,
    price_data: list[dict],
) -> dict:
    """
    Generate a full price comparison for one item across stores.

    Returns:
    {
        "item": item_name,
        "matches": [{store, name, price, unit_price}],
        "best": {store, price},
        "price_range": {min, max, avg},
        "savings_tip": "Save $X by buying at Y instead of Z"
    }
    """
    matches = []
    canonical_query = normalize_product_name(item_name)

    for entry in price_data:
        score = similarity(item_name, entry.get("name", ""))
        if score >= 0.4:
            matches.append({
                "store": entry.get("store"),
                "name": entry.get("name"),
                "price": entry.get("price"),
                "unit_price": entry.get("unit_price"),
                "size": entry.get("size"),
                "similarity": score,
            })

    # Best price
    valid_prices = [m for m in matches if m["price"] is not None]
    valid_prices.sort(key=lambda x: x["price"])

    result = {
        "item": item_name,
        "matches": matches,
        "best": valid_prices[0] if valid_prices else None,
        "price_range": {},
        "savings_tip": None,
    }

    if len(valid_prices) >= 2:
        prices = [m["price"] for m in valid_prices]
        result["price_range"] = {
            "min": min(prices),
            "max": max(prices),
            "avg": sum(prices) / len(prices),
        }
        # Savings tip
        worst = valid_prices[-1]
        best = valid_prices[0]
        savings = worst["price"] - best["price"]
        if savings > 0.5:
            result["savings_tip"] = (
                f"Save ${savings:.2f} by buying at {best['store']} "
                f"(${best['price']:.2f}) instead of {worst['store']} "
                f"(${worst['price']:.2f})"
            )

    return result


def sale_detection(
    current_prices: list[dict],
    history_prices: list[dict],
    threshold_pct: float = 0.15,
) -> list[dict]:
    """
    Detect items that are on sale by comparing current vs historical prices.

    Args:
        current_prices: Recent price scrapes
        history_prices: Past price points
        threshold_pct: Minimum price drop to flag as sale (e.g., 0.15 = 15%)

    Returns:
        List of {item, store, current_price, avg_price, savings_pct}
    """
    # Build historical averages
    history_by_key = defaultdict(list)
    for entry in history_prices:
        key = get_canonical_key(entry.get("name", ""))
        price = entry.get("price")
        if key and price:
            history_by_key[key].append(price)

    sales = []
    for entry in current_prices:
        key = get_canonical_key(entry.get("name", ""))
        price = entry.get("price")
        if not key or not price:
            continue

        hist = history_by_key.get(key, [])
        if not hist:
            continue

        avg_hist = sum(hist) / len(hist)
        if avg_hist == 0:
            continue

        drop_pct = (avg_hist - price) / avg_hist
        if drop_pct >= threshold_pct:
            sales.append({
                "item": entry.get("name"),
                "store": entry.get("store"),
                "current_price": price,
                "avg_price": round(avg_hist, 2),
                "savings_pct": round(drop_pct * 100, 1),
                "savings_abs": round(avg_hist - price, 2),
            })

    sales.sort(key=lambda x: x["savings_pct"], reverse=True)
    return sales
