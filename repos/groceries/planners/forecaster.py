"""
Outage forecasting — predicts when you'll need to re-order based on
historical purchase patterns.

Uses simple statistical methods:
- Inter-purchase intervals (mean, median, std dev)
- Purchase frequency per item
- Next purchase date prediction with confidence
"""
import logging
from datetime import datetime, timedelta
from collections import defaultdict
from typing import Optional

from planners import normalize_product_name, get_canonical_key, similarity

logger = logging.getLogger(__name__)


def build_purchase_patterns(orders: list[dict]) -> list[dict]:
    """
    Analyze order history to build purchase patterns per item.

    Args:
        orders: List of order dicts, each with 'order_date' and 'items'

    Returns:
        List of pattern dicts:
        {item_name, store, avg_days_between, last_purchased, predicted_next,
         total_orders, confidence, typical_quantity}
    """
    # Track purchase dates per canonical item
    from collections import defaultdict
    from datetime import datetime

    item_purchases = defaultdict(list)  # canonical_key -> [(date, qty, store, name)]

    for order in orders:
        order_date = order.get("order_date")
        if not order_date:
            continue
        if isinstance(order_date, str):
            try:
                order_date = datetime.fromisoformat(order_date.replace("Z", "+00:00"))
            except (ValueError, TypeError):
                for fmt in ["%Y-%m-%d", "%B %d, %Y", "%m/%d/%Y"]:
                    try:
                        order_date = datetime.strptime(order_date, fmt)
                        break
                    except ValueError:
                        continue
        if not order_date:
            continue

        store = order.get("store", "unknown")
        for item in order.get("items", []):
            item_name = item.get("name", "")
            qty = item.get("quantity", 1)
            if not item_name:
                continue
            key = get_canonical_key(item_name)
            item_purchases[key].append((order_date, qty, store, item_name))

    patterns = []
    for key, purchases in item_purchases.items():
        if len(purchases) < 2:
            # Not enough data for pattern yet
            continue

        purchases.sort(key=lambda x: x[0])

        dates = [p[0] for p in purchases]
        quantities = [p[1] for p in purchases]
        stores = set(p[2] for p in purchases)
        names = [p[3] for p in purchases]

        # Calculate inter-purchase intervals in days
        intervals = []
        for i in range(1, len(dates)):
            delta = (dates[i] - dates[i-1]).days
            if delta > 0:
                intervals.append(delta)

        if not intervals:
            continue

        avg_interval = sum(intervals) / len(intervals)
        median_interval = sorted(intervals)[len(intervals) // 2]

        # Confidence: more purchases = higher confidence
        confidence = min(1.0, len(intervals) / 10.0)
        # Lower std dev = more regular = higher confidence
        if len(intervals) > 1:
            std = (sum((d - avg_interval) ** 2 for d in intervals) / len(intervals)) ** 0.5
            regularity = 1.0 / (1.0 + std / avg_interval) if avg_interval > 0 else 0.0
            confidence = (confidence + regularity) / 2

        last_date = dates[-1]
        predicted_next = last_date + timedelta(days=int(median_interval))
        typical_qty = max(set(quantities), key=quantities.count)

        # Pick the most common store
        store_counts = defaultdict(int)
        for s in stores:
            store_counts[s] += 1
        primary_store = max(store_counts, key=store_counts.get)

        # Get the most recent/full name
        recent_name = names[-1] if names else key

        patterns.append({
            "item_name": recent_name,
            "canonical_key": key,
            "store": primary_store,
            "avg_days_between": round(avg_interval, 1),
            "median_days_between": median_interval,
            "std_days": round(std, 1) if len(intervals) > 1 else None,
            "typical_quantity": typical_qty,
            "last_purchased": last_date.isoformat(),
            "predicted_next": predicted_next.isoformat(),
            "total_orders": len(purchases),
            "confidence": round(confidence, 2),
            "intervals": intervals,
        })

    # Sort by confidence (higher = more reliable prediction)
    patterns.sort(key=lambda p: (p["confidence"], -p["total_orders"]), reverse=True)
    return patterns


def get_due_items(
    patterns: list[dict] | None = None,
    days_ahead: int = 7,
    min_confidence: float = 0.3,
    from_date: Optional[datetime] = None,
) -> list[dict]:
    """
    Get items that are due to be purchased within the next N days.

    Args:
        patterns: Output from build_purchase_patterns()
        days_ahead: How far to look ahead (default 7)
        min_confidence: Minimum confidence threshold
        from_date: Starting date (default: now)

    Returns:
        List of items predicted to be needed soon, sorted by urgency
    """
    if not patterns:
        return []

    now = from_date or datetime.now()
    cutoff = now + timedelta(days=days_ahead)

    due = []
    for p in patterns:
        if p["confidence"] < min_confidence:
            continue

        predicted = datetime.fromisoformat(p["predicted_next"])
        days_until = (predicted - now).days

        if days_until <= days_ahead:
            due.append({
                **p,
                "days_until_predicted": days_until,
                "urgency": "overdue" if days_until < 0 else "soon",
            })

    due.sort(key=lambda x: x["days_until_predicted"])
    return due


def shopping_list_summary(
    patterns: list[dict],
    days_ahead: int = 7,
    min_confidence: float = 0.3,
) -> dict:
    """
    Generate a human-readable shopping summary.

    Returns:
    {
        "overdue": [...],
        "coming_soon": [...],
        "total_items": N,
        "estimated_cost": $X,
        "suggested_stores": [...]
    }
    """
    now = datetime.now()
    due_items = get_due_items(patterns, days_ahead, min_confidence)

    overdue = [d for d in due_items if d["days_until_predicted"] < 0]
    upcoming = [d for d in due_items if d["days_until_predicted"] >= 0]

    # Suggested stores (where most of these items have been bought)
    store_counts = defaultdict(int)
    for d in due_items:
        store_counts[d["store"]] += 1/2 + d.get("total_orders", 0)/10.0  # weighted

    suggested_stores = sorted(store_counts, key=store_counts.get, reverse=True)

    return {
        "overdue": overdue,
        "coming_soon": upcoming,
        "total_items": len(due_items),
        "item_count": {"overdue": len(overdue), "upcoming": len(upcoming)},
        "suggested_stores": suggested_stores,
        "prediction_date": now.isoformat(),
        "window_days": days_ahead,
    }
