"""
Database setup and session management.
"""
from pathlib import Path
import logging
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from models import Base

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

DB_PATH = DATA_DIR / "grocery.db"
DATABASE_URL = f"sqlite:///{DB_PATH}"


def get_engine(db_url: str = None):
    """Create SQLAlchemy engine with SQLite."""
    url = db_url or DATABASE_URL
    return create_engine(url, echo=False)


def init_db(engine=None):
    """Create all tables."""
    eng = engine or get_engine()
    Base.metadata.create_all(eng)
    logger.info(f"Database initialized at {DB_PATH}")


def get_session(engine=None) -> Session:
    """Get a SQLAlchemy session."""
    eng = engine or get_engine()
    Session = sessionmaker(bind=eng)
    return Session()


def store_order(session: Session, store: str, order_data: dict):
    """Store an order and its items from scraper output dict."""
    from models import Order, OrderItem
    from datetime import datetime
    
    order = session.query(Order).filter_by(
        store=store, order_id=order_data["order_id"]
    ).first()

    if not order:
        order = Order(
            store=store,
            order_id=order_data["order_id"],
            order_date=_parse_date(order_data.get("order_date")),
            total=order_data.get("total"),
            currency=order_data.get("currency", "USD"),
            status=order_data.get("status"),
            shipping_address=order_data.get("shipping_address"),
            item_count=order_data.get("item_count", len(order_data.get("items", []))),
            raw_data=order_data.get("raw_data"),
        )
        session.add(order)
        session.flush()

        for item_data in order_data.get("items", []):
            item = OrderItem(
                order_id_fk=order.id,
                item_name=item_data.get("name", "Unknown"),
                quantity=item_data.get("quantity", 1),
                price=item_data.get("price"),
                sku=item_data.get("sku"),
                category=item_data.get("category"),
            )
            session.add(item)

        session.commit()
        logger.info(f"Stored order {order_data['order_id']} from {store}")
    else:
        logger.debug(f"Order {order_data['order_id']} already exists, skipping")
    
    return order


def _parse_date(d):
    if not d:
        return None
    if isinstance(d, str):
        from datetime import datetime
        for fmt in ["%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%S%z",
                     "%B %d, %Y", "%m/%d/%Y", "%m/%d/%Y %H:%M:%S"]:
            try:
                return datetime.strptime(d, fmt)
            except ValueError:
                continue
    return d
