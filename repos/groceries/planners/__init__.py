"""
Fuzzy product matcher — matches product names across stores.
For example: "Whole Milk Gallon" at Walmart = "Milk Whole Gallon" at Kroger.
Uses normalized token comparison and Levenshtein distance.
"""
import re
import logging
from typing import Optional
from difflib import SequenceMatcher

logger = logging.getLogger(__name__)


# ─── Normalization ───────────────────────────────────────────────────────

STOP_WORDS = {
    "organic", "conventional", "fresh", "frozen", "canned", "dried",
    "premium", "select", "choice", "great", "value", "best", "our",
    "brand", "original", "classic", "traditional", "natural",
    "sliced", "diced", "chopped", "whole", "minced", "ground", "boneless",
    "skinless", "breast", "thigh", "drumstick", "wing",
    "red", "green", "yellow", "white", "brown", "golden",
    "large", "small", "medium", "extra", "jumbo", "family", "bulk",
    "with", "without", "and", "the", "a", "an", "in", "of", "for",
    "100%", "pure", "all", "real", "ready", "easy",
}

UNIT_WORDS = {
    "oz", "lb", "lbs", "g", "kg", "ml", "l", "gal", "qt", "pt",
    "count", "each", "pack", "bunch", "bag", "box", "bottle", "can", "jar",
    "dozen", "half", "gallon", "quart", "pint", "liter", "pound",
    "ounce", "ounces", "pounds", "grams", "milliliter", "liter",
}

MEASURE_RE = re.compile(r'(\d+\s*(?:oz|lb|lbs|g|kg|ml|l|gal|qt|pt|count|pack|ct))', re.IGNORECASE)


def normalize_product_name(name: str) -> str:
    """
    Normalize a product name for comparison:
    - Lowercase
    - Remove units of measure
    - Remove common stop words
    - Sort remaining tokens alphabetically
    """
    if not name:
        return ""

    name = name.lower().strip()

    # Remove parenthetical notes
    name = re.sub(r'\([^)]*\)', '', name)

    # Remove size at the end (common pattern: "Item Name 12 oz")
    name = re.sub(r'\d+\s*(?:oz|lb|lbs|g|kg|ml|l|gal|qt|pt|ct|count|pack|each)\s*$', '', name, flags=re.IGNORECASE)
    name = re.sub(r'\d+\s*(?:oz|lb|lbs|g|kg|ml|l|gal|qt|pt|ct|count|pack|each)\s+', ' ', name, flags=re.IGNORECASE)

    # Tokenize
    tokens = re.findall(r'[a-z0-9]+', name)

    # Remove stop words and unit words
    tokens = [t for t in tokens if t not in STOP_WORDS and t not in UNIT_WORDS and len(t) > 1]

    # Sort for canonical comparison
    tokens.sort()

    return " ".join(tokens)


def get_canonical_key(name: str) -> str:
    """Get a deduplication key — aggressively normalized."""
    norm = normalize_product_name(name)
    # Further aggressive: keep only meaningful words
    tokens = norm.split()
    # Remove numbers that aren't product identifiers
    tokens = [t for t in tokens if not re.match(r'^\d+$', t) or t in ('100', )]
    return " ".join(tokens)


# ─── Matching ────────────────────────────────────────────────────────────

def similarity(a: str, b: str) -> float:
    """Compute similarity between two product names (0.0 to 1.0)."""
    na = normalize_product_name(a)
    nb = normalize_product_name(b)
    if not na or not nb:
        return 0.0
    return SequenceMatcher(None, na, nb).ratio()


def is_match(a: str, b: str, threshold: float = 0.65) -> bool:
    """Check if two product names refer to the same item."""
    return similarity(a, b) >= threshold


def find_best_match(query: str, candidates: list[str], threshold: float = 0.6) -> Optional[tuple[str, float]]:
    """Find the best matching candidate for a query string."""
    best_score = 0
    best = None
    for cand in candidates:
        score = similarity(query, cand)
        if score > best_score:
            best_score = score
            best = cand
    if best and best_score >= threshold:
        return (best, best_score)
    return None


def group_products(products: list[dict], name_key: str = "name") -> dict[str, list[dict]]:
    """
    Group products from different stores that are likely the same item.
    Returns dict mapping canonical name -> list of product dicts.
    """
    groups = {}
    for prod in products:
        key = get_canonical_key(prod.get(name_key, ""))
        if key:
            if key not in groups:
                groups[key] = []
            groups[key].append(prod)

    # Merge similar groups
    merged = {}
    assigned = set()
    keys = list(groups.keys())
    for i, k1 in enumerate(keys):
        if k1 in assigned:
            continue
        merged[k1] = groups[k1]
        assigned.add(k1)
        for k2 in keys[i+1:]:
            if k2 in assigned:
                continue
            if similarity(k1, k2) >= 0.6:
                merged[k1].extend(groups[k2])
                assigned.add(k2)

    return merged
