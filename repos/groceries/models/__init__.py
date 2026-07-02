"""
Data models for grocery automation.
"""
from datetime import datetime
from decimal import Decimal
from typing import Optional
from sqlalchemy import Column, Integer, String, Float, DateTime, Boolean, JSON, ForeignKey, Text, Numeric
from sqlalchemy.orm import DeclarativeBase, relationship


class Base(DeclarativeBase):
    pass


class StoredItem(Base):
    """An item in a store's catalog."""
    __tablename__ = "items"

    id = Column(Integer, primary_key=True)
    store = Column(String(50), nullable=False, index=True)        # walmart, kroger, etc.
    item_id = Column(String(255), nullable=False)                  # Store's SKU/UPC
    name = Column(String(500), nullable=False)
    brand = Column(String(200), nullable=True)
    category = Column(String(200), nullable=True)
    size = Column(String(100), nullable=True)                      # "12 oz", "1 gal", etc.
    price = Column(Numeric(10, 2), nullable=True)
    unit_price = Column(Numeric(10, 4), nullable=True)             # per-oz, per-each
    currency = Column(String(3), default="USD")
    in_stock = Column(Boolean, default=True)
    url = Column(Text, nullable=True)
    image_url = Column(Text, nullable=True)
    scraped_at = Column(DateTime, default=datetime.now)

    __table_args__ = (
        {"sqlite_autoincrement": True},
    )


class Order(Base):
    """A completed order/purchase."""
    __tablename__ = "orders"

    id = Column(Integer, primary_key=True)
    store = Column(String(50), nullable=False, index=True)
    order_id = Column(String(255), nullable=False)                 # Store's order number
    order_date = Column(DateTime, nullable=True)
    total = Column(Numeric(10, 2), nullable=True)
    currency = Column(String(3), default="USD")
    status = Column(String(50), nullable=True)                     # Delivered, Shipped, etc.
    shipping_address = Column(Text, nullable=True)
    item_count = Column(Integer, nullable=True)
    raw_data = Column(JSON, nullable=True)                         # Store's full order JSON
    scraped_at = Column(DateTime, default=datetime.now)

    items = relationship("OrderItem", back_populates="order")


class OrderItem(Base):
    """Individual item within an order."""
    __tablename__ = "order_items"

    id = Column(Integer, primary_key=True)
    order_id_fk = Column(Integer, ForeignKey("orders.id"))
    item_name = Column(String(500), nullable=False)
    quantity = Column(Integer, default=1)
    price = Column(Numeric(10, 2), nullable=True)
    sku = Column(String(255), nullable=True)
    category = Column(String(200), nullable=True)

    order = relationship("Order", back_populates="items")


class Store(Base):
    """A physical store location."""
    __tablename__ = "stores"

    id = Column(Integer, primary_key=True)
    store_chain = Column(String(50), nullable=False, index=True)
    store_name = Column(String(200), nullable=True)                # "Walmart #1234"
    address = Column(String(500), nullable=True)
    city = Column(String(100), nullable=True)
    state = Column(String(50), nullable=True)
    zip_code = Column(String(20), nullable=True)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    phone = Column(String(50), nullable=True)
    hours = Column(JSON, nullable=True)
    is_active = Column(Boolean, default=True)


class PriceHistory(Base):
    """Historical price tracking for items."""
    __tablename__ = "price_history"

    id = Column(Integer, primary_key=True)
    store = Column(String(50), nullable=False, index=True)
    item_name = Column(String(500), nullable=False)
    sku = Column(String(255), nullable=True, index=True)
    price = Column(Numeric(10, 2), nullable=False)
    unit_price = Column(Numeric(10, 4), nullable=True)
    sale_price = Column(Numeric(10, 2), nullable=True)
    in_stock = Column(Boolean, default=True)
    scraped_at = Column(DateTime, default=datetime.now, index=True)


class PurchasePattern(Base):
    """Learned purchase frequency for outage forecasting."""
    __tablename__ = "purchase_patterns"

    id = Column(Integer, primary_key=True)
    store = Column(String(50), nullable=False)
    item_name = Column(String(500), nullable=False)
    sku = Column(String(255), nullable=True)
    typical_quantity = Column(Integer, default=1)
    avg_days_between = Column(Float, nullable=True)                # computed pattern
    last_purchased = Column(DateTime, nullable=True)
    predicted_next = Column(DateTime, nullable=True)               # next expected purchase
    total_orders = Column(Integer, default=0)
    confidence = Column(Float, default=0.0)                        # 0.0-1.0
    is_active = Column(Boolean, default=True)
    updated_at = Column(DateTime, default=datetime.now)
