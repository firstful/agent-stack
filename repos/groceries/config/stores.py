"""Store locations for grocery price scraping."""
import json
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent / "data"

STORES = {
    "walmart": {
        "name": "Walmart",
        "address": "2793 Taylor Rd Ext, Reynoldsburg, OH 43068",
        "lat": 39.9542,
        "lon": -82.8180,
    },
    "kroger": {
        "name": "Kroger",
        "address": "1045 Hill Rd N, Pickerington, OH 43147",
        "lat": 39.9104,
        "lon": -82.7690,
    },
    "aldi": {
        "name": "ALDI",
        "address": "1400 Hill Rd N, Pickerington, OH 43147",
        "lat": 39.9108,
        "lon": -82.7694,
    },
    "samsclub": {
        "name": "Sam's Club",
        "address": "2675 Taylor Rd Ext, Reynoldsburg, OH 43068",
        "lat": 39.9545,
        "lon": -82.8173,
    },
    "amazon": {
        "name": "Amazon",
        "address": "Online",
        "lat": None,
        "lon": None,
    },
}


def get_stores():
    return STORES


def save_stores():
    """Write store locations to data/stores.json."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    path = DATA_DIR / "stores.json"
    with open(path, "w") as f:
        json.dump(STORES, f, indent=2)
    return path
